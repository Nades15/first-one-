/* Pipeline end-to-end on a virtual clock — node --test fairline/test/pipeline.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createPipeline } = require('../js/pipeline.js');
const { createPaperBroker } = require('../js/paperBroker.js');
const { createRisk } = require('../js/risk.js');
const { testCfg, tempStore, book, aboveMarket } = require('./helpers.js');

function makePipe(cfgOver) {
  const cfg = testCfg(cfgOver);
  const store = tempStore();
  const risk = createRisk({ cfg, store, now: () => 0 });
  const broker = createPaperBroker(cfg);
  const pipe = createPipeline({ cfg, store, risk, broker });
  return { cfg, store, risk, broker, pipe };
}

/* Alternating ±0.1% around `mid` warms the vol estimator to σ ≈ 0.002/√s. */
function feedSpot(pipe, asset, mid, t0, t1) {
  for (let t = t0, i = 0; t <= t1; t += 1000, i++) {
    pipe.onSpot(asset, mid * Math.exp(0.001 * (i % 2 ? 1 : -1)), t);
  }
}

test('mispriced market: enter, hold, settle as a win at close', () => {
  const { store, pipe } = makePipe();
  const m = aboveMarket({ closeTime: 60e3 });          // BTC above 100 at t=60s
  pipe.onMarkets([m], 0);
  feedSpot(pipe, 'BTC', 101, 0, 10e3);                 // spot ~101 ⇒ fair ≈ 0.75
  for (let t = 1000; t <= 9000; t += 1000) pipe.onTick(t);   // warming up — no book yet
  assert.equal(pipe.positions.count(), 0);

  pipe.onBook(m.key, book(10e3, 0.50, 0.55, 100));     // crowd says 52.5% — too cheap
  pipe.onTick(10e3);                                   // decision + order (latency 1s)
  assert.equal(pipe.positions.count(), 0);             // not filled yet
  feedSpot(pipe, 'BTC', 101, 11e3, 60e3);
  pipe.onTick(11e3);                                   // fill lands
  assert.equal(pipe.positions.count(), 1);
  const pos = pipe.positions.all()[0];
  assert.equal(pos.side, 'yes');
  assert.equal(pos.contracts, Math.floor(10 / 0.55));  // 18
  assert.equal(pos.avgPrice, 0.55);
  assert.ok(pos.entryFair > 0.6 && pos.entryFair < 0.9);

  for (let t = 12e3; t <= 60e3; t += 1000) pipe.onTick(t);   // ride to resolution
  assert.equal(pipe.positions.count(), 0);
  const trades = store.allTrades();
  assert.equal(trades.length, 1);
  const rec = trades[0];
  assert.equal(rec.exitReason, 'SETTLED');
  assert.equal(rec.won, true);                         // spot ~101 > floor 100
  assert.ok(Math.abs(rec.pnlNetUsd - (18 - 18 * 0.55)) < 1e-6);
  assert.equal(store.gateStats().paperTrades, 1);
  assert.equal(pipe.watchedCount, 0);                  // settled market cleaned up
});

test('flip exit: the book coming to us gets taken before resolution', () => {
  const { store, pipe } = makePipe();
  const m = aboveMarket({ closeTime: 300e3 });
  pipe.onMarkets([m], 0);
  feedSpot(pipe, 'BTC', 101, 0, 10e3);
  pipe.onBook(m.key, book(10e3, 0.50, 0.55, 100));
  pipe.onTick(10e3);
  pipe.onTick(11e3);                                   // entry filled @0.55
  assert.equal(pipe.positions.count(), 1);

  feedSpot(pipe, 'BTC', 98.5, 11e3, 20e3);             // crash: fair collapses well below bid
  pipe.onBook(m.key, book(20e3, 0.50, 0.55, 100));
  pipe.onTick(20e3);                                   // bid 0.50 − fair ≥ flip edge ⇒ exit request
  pipe.onTick(21e3);                                   // sell fills at the bid
  assert.equal(pipe.positions.count(), 0);
  const rec = store.allTrades()[0];
  assert.equal(rec.exitReason, 'FLIP_EXIT');
  assert.equal(rec.won, null);                         // no resolution observed
  assert.ok(Math.abs(rec.pnlNetUsd - (18 * 0.50 - 18 * 0.55)) < 1e-6);
});

test('up-or-down: open captured at windowStart, missed windows go unpriceable', () => {
  const { pipe } = makePipe();
  const live = aboveMarket({ key: 'polymarket:ud1', id: 'ud1', kind: 'updown',
    floor: null, cap: null, windowStart: 5e3, closeTime: 120e3 });
  const missed = aboveMarket({ key: 'polymarket:ud2', id: 'ud2', kind: 'updown',
    floor: null, cap: null, windowStart: -60e3, closeTime: 120e3 });
  pipe.onMarkets([live, missed], 0);
  feedSpot(pipe, 'BTC', 101, 0, 6e3);
  pipe.onTick(6e3);                                    // within the capture grace
  const snap = pipe.snapshot(6e3);
  const ud1 = snap.markets.find(x => x.key === 'polymarket:ud1');
  const ud2 = snap.markets.find(x => x.key === 'polymarket:ud2');
  assert.ok(ud1.floor > 0, 'open price captured as the strike');
  assert.equal(ud2.floor, null);
  assert.equal(ud2.status, 'UNPRICEABLE');
});

test('risk caps hold: concurrency and panic', () => {
  const { risk, pipe } = makePipe({ RISK: { maxConcurrent: 1 } });
  const m1 = aboveMarket({ key: 'k:1', id: '1', closeTime: 300e3 });
  const m2 = aboveMarket({ key: 'k:2', id: '2', closeTime: 300e3 });
  pipe.onMarkets([m1, m2], 0);
  feedSpot(pipe, 'BTC', 101, 0, 10e3);
  pipe.onBook('k:1', book(10e3, 0.50, 0.55, 100));
  pipe.onBook('k:2', book(10e3, 0.50, 0.55, 100));
  pipe.onTick(10e3);
  pipe.onTick(11e3);
  assert.equal(pipe.positions.count(), 1);             // second entry blocked

  pipe.panicExit(12e3);                                // sell request now
  feedSpot(pipe, 'BTC', 101, 12e3, 14e3);
  pipe.onTick(13e3);                                   // fill after latency
  assert.equal(pipe.positions.count(), 0);
  assert.equal(risk.mode(), 'HALTED_PANIC');
  pipe.onTick(14e3);
  assert.equal(pipe.positions.count(), 0);             // and nothing re-enters
});
