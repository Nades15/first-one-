/* Fairline — offline mock world (Scout's ?mock=1 in spirit). A seeded
 * random-walk spot plus synthetic markets whose books drift between honest
 * and mispriced, driven through the REAL pipeline: discovery, fair pricing,
 * entries, fills, and settlement all run exactly as live — just with no
 * network. `node fairline --mock` shows the dashboard working end to end;
 * tests drive the same generator on a virtual clock.
 *
 * The mispricing is planted (a slow sinusoidal bias on the crowd's price),
 * so the bot SHOULD profit here. That proves plumbing, not edge. */
'use strict';

const { probAbove } = require('./fair.js');

/* Deterministic RNG (mulberry32) so every mock run replays the same tape. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_ASSETS = { BTC: 118000, ETH: 3600, SOL: 165 };
const SIGMA_PER_SQRT_SEC = 0.0003;         // ≈1.8%/√hour — plausible crypto vol

function createMockWorld(opts) {
  const seed = (opts && opts.seed) || 42;
  const rand = mulberry32(seed);
  const gauss = () => {
    // Box–Muller from two uniforms
    const u = Math.max(rand(), 1e-12), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const prices = Object.assign({}, MOCK_ASSETS);
  let marketSeq = 0;

  function stepSpot(dtSec) {
    for (const a of Object.keys(prices)) {
      prices[a] *= Math.exp(SIGMA_PER_SQRT_SEC * Math.sqrt(dtSec) * gauss());
    }
    return Object.assign({}, prices);
  }

  /* A fresh batch of synthetic above/below markets around current spot,
   * closing minutesOut from t. Platforms alternate so both fee models run. */
  function makeMarkets(t, count) {
    const list = [];
    for (let i = 0; i < (count || 6); i++) {
      const asset = Object.keys(prices)[i % 3];
      const spot = prices[asset];
      const minutesOut = 2 + Math.floor(rand() * 8);   // settle within the demo window
      const closeTime = t + minutesOut * 60e3;
      const strike = round2(spot * (1 + (rand() - 0.5) * 0.004));   // ±0.2% of spot
      const above = rand() < 0.5;
      const id = 'mock-' + (++marketSeq);
      list.push({
        platform: i % 2 === 0 ? 'polymarket' : 'kalshi',
        id, key: 'mock:' + id, asset,
        kind: above ? 'above' : 'below',
        floor: above ? strike : null,
        cap: above ? null : strike,
        closeTime, windowStart: null,
        title: (above ? 'Mock: ' + asset + ' above $' : 'Mock: ' + asset + ' below $') + strike +
          ' in ' + minutesOut + 'm',
        url: 'https://example.invalid/' + id,
        tokenIds: null, yesLabel: 'Yes',
      });
    }
    return list;
  }

  /* The crowd's book: fair value plus a slow sinusoidal bias and noise —
   * sometimes honest, sometimes wrong enough to clear minEdge. */
  function makeBook(m, t) {
    const spot = prices[m.asset];
    const tauSec = Math.max(0, (m.closeTime - t) / 1000);
    const strike = m.floor != null ? m.floor : m.cap;
    let fair = probAbove(spot, strike, SIGMA_PER_SQRT_SEC, tauSec);
    if (m.kind === 'below') fair = 1 - fair;
    const bias = 0.09 * Math.sin(t / 90e3 + (m.id.charCodeAt(5) || 0));
    const crowd = Math.min(0.97, Math.max(0.03, fair + bias + (rand() - 0.5) * 0.01));
    const spread = 0.02 + rand() * 0.02;
    const bid = Math.max(0.01, round2(crowd - spread / 2));
    const ask = Math.min(0.99, round2(crowd + spread / 2));
    const size = () => 100 + Math.floor(rand() * 400);
    return {
      t,
      bids: [{ p: bid, s: size() }, { p: round2(bid - 0.02), s: size() }].filter(l => l.p > 0),
      asks: [{ p: ask, s: size() }, { p: round2(ask + 0.02), s: size() }].filter(l => l.p < 1),
    };
  }

  return { stepSpot, makeMarkets, makeBook, prices };
}

/* Drive a pipeline (or recorder) from the mock world on real timers. */
function createMockSource(opts) {
  const pipe = opts.pipe;
  const cfg = opts.cfg;
  const world = createMockWorld(opts);
  let markets = [];
  let timers = [];

  function sweep(t) {
    markets = markets.filter(m => m.closeTime > t);
    if (markets.length < 6) markets = markets.concat(world.makeMarkets(t, 6 - markets.length));
    pipe.onMarkets(markets.slice(), t);
  }

  return {
    start() {
      const every = (ms, fn) => { const h = setInterval(fn, ms); if (h.unref) h.unref(); timers.push(h); };
      sweep(Date.now());
      const prices0 = world.stepSpot(0);
      for (const [a, p] of Object.entries(prices0)) pipe.onSpot(a, p, Date.now());
      every(1000, () => {
        const t = Date.now();
        const prices = world.stepSpot(1);
        for (const [a, p] of Object.entries(prices)) pipe.onSpot(a, p, t);
      });
      every(2500, () => {
        const t = Date.now();
        for (const m of markets) if (m.closeTime > t) pipe.onBook(m.key, world.makeBook(m, t));
      });
      every(30e3, () => sweep(Date.now()));
    },
    stop() { timers.forEach(clearInterval); timers = []; },
    world,
  };
}

/* Drive a pipeline from the mock world on a VIRTUAL clock — no timers, no
 * wall time. Mirrors createMockSource's cadence exactly (spot every tick,
 * books every 2.5s, sweeps every 30s) but fast-forwards simulated hours in
 * seconds of CPU, so a settings vector can be measured on hundreds of
 * settled trades instead of a dozen. Deterministic for a given seed.
 *
 *   runVirtual(world, pipe, {
 *     tickMs,                     // engine cadence (default 1000)
 *     t0,                         // virtual epoch (default 2026-01-01 UTC)
 *     maxSimMs,                   // hard stop (default 14 virtual days)
 *     onTime(t),                  // called each tick BEFORE pipeline calls —
 *                                 //   wire the risk manager's clock to this
 *     until(t),                   // checked every sweep; true stops the run
 *   }) → { t0, simMs }                                                    */
function runVirtual(world, pipe, opts) {
  const o = opts || {};
  const tickMs = o.tickMs || 1000;
  const t0 = o.t0 != null ? o.t0 : Date.UTC(2026, 0, 1);
  const maxSimMs = o.maxSimMs || 14 * 24 * 3600e3;
  const onTime = o.onTime || (() => {});
  const until = o.until || (() => false);

  let markets = [];
  function sweep(t) {
    markets = markets.filter(m => m.closeTime > t);
    if (markets.length < 6) markets = markets.concat(world.makeMarkets(t, 6 - markets.length));
    pipe.onMarkets(markets.slice(), t);
  }

  onTime(t0);
  sweep(t0);
  for (const [a, p] of Object.entries(world.stepSpot(0))) pipe.onSpot(a, p, t0);

  let t = t0, nextBook = t0 + 2500, nextSweep = t0 + 30e3;
  while (t - t0 < maxSimMs) {
    t += tickMs;
    onTime(t);
    const prices = world.stepSpot(tickMs / 1000);
    for (const [a, p] of Object.entries(prices)) pipe.onSpot(a, p, t);
    if (t >= nextBook) {
      for (const m of markets) if (m.closeTime > t) pipe.onBook(m.key, world.makeBook(m, t));
      nextBook += 2500;
    }
    if (t >= nextSweep) {
      sweep(t);
      nextSweep += 30e3;
      if (until(t)) break;
    }
    pipe.onTick(t);
  }
  return { t0, simMs: t - t0 };
}

function round2(x) { return Math.round(x * 100) / 100; }

module.exports = { createMockWorld, createMockSource, runVirtual, MOCK_ASSETS, SIGMA_PER_SQRT_SEC };
