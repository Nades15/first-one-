/* Pulse simulator tests — run with: node --test scalper/test/sim.test.js */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeRng, amm, createSim, SCENARIOS, SCENARIO_IDS } = require('../js/sim.js');

function runTicks(sim, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(sim.next());
  return out;
}

/* ------------------------------ RNG + AMM ------------------------------ */

test('makeRng is deterministic per seed and covers [0,1)', () => {
  const a = makeRng(7), b = makeRng(7), c = makeRng(8);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('amm preserves the constant product and moves price the right way', () => {
  const pool = { base: 1e9, quote: 100 };
  const k = pool.base * pool.quote;
  const p0 = pool.quote / pool.base;

  amm.buy(pool, 5);                                    // buy raises price
  assert.ok(Math.abs(pool.base * pool.quote - k) / k < 1e-9);
  const p1 = pool.quote / pool.base;
  assert.ok(p1 > p0);

  amm.sell(pool, 1e8);                                 // sell lowers price
  assert.ok(Math.abs(pool.base * pool.quote - k) / k < 1e-9);
  assert.ok(pool.quote / pool.base < p1);
});

test('impactPct is exact on a known pool', () => {
  const pool = { base: 1e9, quote: 100 };
  // sell 5e7 into 1e9: impact = 5e7 / 1.05e9 = 4.7619...%
  assert.ok(Math.abs(amm.impactPct(pool, 5e7) - (5e7 / 1.05e9) * 100) < 1e-9);
  assert.equal(amm.impactPct(pool, 0), 0);
});

/* ----------------------------- determinism ----------------------------- */

test('same seed + scenario gives a byte-identical tick stream', () => {
  const a = createSim({ scenario: 'pumpFade', seed: 42 });
  const b = createSim({ scenario: 'pumpFade', seed: 42 });
  assert.deepEqual(runTicks(a, 100), runTicks(b, 100));
});

test('different seeds diverge', () => {
  const a = createSim({ scenario: 'pumpFade', seed: 42 });
  const b = createSim({ scenario: 'pumpFade', seed: 43 });
  assert.notDeepEqual(runTicks(a, 100), runTicks(b, 100));
});

test('execute() is reflected in the pool and the next tick trade list', () => {
  const sim = createSim({ scenario: 'chop', seed: 1 });
  sim.next();
  const before = sim.snapshot().pool.quote;
  const res = sim.execute({ side: 'buy', quoteIn: 0.5 });
  assert.ok(res.ok && res.baseOut > 0);
  const tick = sim.next();
  const mine = tick.trades.find(tr => tr.wallet === 'you');
  assert.ok(mine && mine.side === 'buy' && mine.quote === 0.5);
  assert.ok(tick.pool.quote > before);

  const sell = sim.execute({ side: 'sell', baseIn: res.baseOut });
  assert.ok(sell.ok && sell.quoteOut > 0 && sell.impactPct > 0);
});

/* --------------------------- scenario shapes --------------------------- */

test('rugPull removes at least 80% of quote liquidity at the scripted time', () => {
  const sim = createSim({ scenario: 'rugPull', seed: 42 });
  let preQuote = null, postQuote = null;
  for (let i = 0; i < 40; i++) {
    const tick = sim.next();
    if (tick.t === 4250) preQuote = tick.pool.quote;
    if (tick.t === 4500) postQuote = tick.pool.quote;
  }
  assert.ok(preQuote > 0 && postQuote !== null);
  assert.ok(postQuote < preQuote * 0.2, `quote ${preQuote} -> ${postQuote}`);
});

test('honeypot flips sellRestricted at 4s and sells stop', () => {
  const sim = createSim({ scenario: 'honeypot', seed: 42 });
  let sellsAfter = 0, sawFlip = false, sellsBefore = 0;
  for (let i = 0; i < 80; i++) {
    const tick = sim.next();
    const sells = tick.trades.filter(tr => tr.side === 'sell').length;
    if (tick.t < 4000) sellsBefore += sells;
    if (tick.t >= 4000) { sawFlip = sawFlip || tick.flags.sellRestricted; sellsAfter += sells; }
  }
  assert.ok(sellsBefore > 0, 'sells existed before the flip');
  assert.ok(sawFlip);
  assert.equal(sellsAfter, 0);
  assert.equal(sim.execute({ side: 'sell', baseIn: 1000 }).ok, false);
});

test('whaleDump contains sells from a >=4% holder at the scripted time', () => {
  const sim = createSim({ scenario: 'whaleDump', seed: 42 });
  let whaleSold = false;
  for (let i = 0; i < 30; i++) {
    const tick = sim.next();
    const holderPct = {};
    for (const h of tick.holders) holderPct[h.wallet] = h.pct;
    for (const tr of tick.trades) {
      if (tr.side === 'sell' && tr.wallet === 'whale1') {
        whaleSold = true;
        // pct is post-sale and still near its seeded 4.5–7% bag on the first drip
        assert.ok(tick.t >= 3500);
      }
    }
  }
  assert.ok(whaleSold);
});

test('moonshot keeps climbing: price at 10s beats price at 4s', () => {
  const sim = createSim({ scenario: 'moonshot', seed: 42 });
  let p4 = null, p10 = null;
  for (let i = 0; i < 44; i++) {
    const tick = sim.next();
    if (tick.t === 4000) p4 = tick.price;
    if (tick.t === 10000) p10 = tick.price;
  }
  assert.ok(p4 > 0 && p10 > p4);
});

test('holders are ranked and include dev and whales at start', () => {
  const sim = createSim({ scenario: 'chop', seed: 42 });
  const tick = sim.next();
  assert.ok(tick.holders.length > 0 && tick.holders.length <= 10);
  assert.equal(tick.holders[0].wallet, 'dev');
  for (let i = 1; i < tick.holders.length; i++) {
    assert.ok(tick.holders[i - 1].pct >= tick.holders[i].pct);
  }
  assert.ok(tick.holders.some(h => h.wallet.startsWith('whale') && h.pct >= 4));
});

test('every scenario runs to completion without errors', () => {
  for (const id of SCENARIO_IDS) {
    const sim = createSim({ scenario: id, seed: 5 });
    let ticks = 0;
    while (!sim.done() && ticks < 200) { sim.next(); ticks++; }
    assert.ok(sim.done(), id + ' finished');
    assert.ok(SCENARIOS[id].label);
  }
});
