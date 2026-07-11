/* Pulse smart-exit engine tests — run with: node --test scalper/test/exit.test.js
 * Fixtures are hand-built ticks (no simulator dependency) so failures localize
 * to the engine. Tick cadence is 250ms, matching the sim default. */
const { test } = require('node:test');
const assert = require('node:assert');
const { create, sellImpactPct, DEFAULT_CFG } = require('../js/exit.js');

const FLAGS = { sellRestricted: false, mintEnabled: false, lpUnlocked: false, blacklistRisk: false };

function mkTick(t, over) {
  return Object.assign({
    t, price: 1e-7, trades: [],
    pool: { base: 1e9, quote: 100 },
    holders: [],
    flags: Object.assign({}, FLAGS),
  }, over);
}
const buy = (quote, wallet) => ({ side: 'buy', base: quote / 1e-7, quote, wallet: wallet || 'w1' });
const sell = (quote, wallet) => ({ side: 'sell', base: quote / 1e-7, quote, wallet: wallet || 'w2' });

/* Feed ticks t=250..endMs at 250ms; build each tick via make(t). */
function feed(ex, endMs, make) {
  let last = null;
  for (let t = 250; t <= endMs; t += 250) { ex.onTick(make(t)); last = t; }
  return last;
}

/* ----------------------------- signal math ----------------------------- */

test('price velocity is an exact per-second EMA of log returns', () => {
  const ex = create();
  // constant per-tick log return of 0.0025 -> 0.0025 * 4/s = 1.0%/s
  feed(ex, 1000, t => mkTick(t, { price: 100 * Math.exp(0.0025 * (t / 250 - 1)) }));
  assert.ok(Math.abs(ex.snapshot().velPctPerSec - 1.0) < 1e-9);
});

test('buy/sell volume ratio and pressure trend split the window in half', () => {
  const ex = create();
  // window (250, 3250]: prior half gets buy1+sell1 (ratio .5), recent half buy3+sell1 (.75)
  feed(ex, 3250, t => mkTick(t, {
    trades: t === 1000 ? [buy(1), sell(1)] : t === 2500 ? [buy(3), sell(1)] : [],
  }));
  const s = ex.snapshot();
  assert.ok(Math.abs(s.buyVolRatio - 4 / 6) < 1e-9);
  assert.ok(Math.abs(s.pressureTrend - 0.25) < 1e-9);
});

test('empty flow windows read as a neutral 0.5 ratio', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  assert.equal(ex.snapshot().buyVolRatio, 0.5);
  assert.equal(ex.snapshot().pressureTrend, 0);
});

test('volume acceleration compares recent 2s flow rate against the prior 4s', () => {
  const ex = create();
  // base [250,4250): 8x 1 SOL = 2 SOL/s. recent [4250,6250): 4x 2 SOL = 4 SOL/s.
  feed(ex, 6250, t => mkTick(t, {
    trades: (t % 500 === 0 && t <= 4000) ? [buy(1)]
      : (t % 500 === 0 && t >= 4500) ? [buy(2)] : [],
  }));
  assert.ok(Math.abs(ex.snapshot().volAccel - 2.0) < 1e-9);
});

test('expected sell impact is exact constant-product math', () => {
  const pool = { base: 1e9, quote: 100 };
  assert.ok(Math.abs(sellImpactPct(pool, 5e7) - (5e7 / 1.05e9) * 100) < 1e-9);
  const ex = create();
  feed(ex, 500, t => mkTick(t));
  ex.onEntry({ t: 500, price: 1e-7, sizeBase: 5e7 });
  assert.ok(Math.abs(ex.snapshot().impactPct - (5e7 / 1.05e9) * 100) < 1e-9);
});

/* ------------------------- discretionary exits ------------------------- */

test('weak momentum holds through the grace period, then sells immediately', () => {
  const ex = create();
  const falling = t => mkTick(t, { price: 100 * Math.exp(-0.005 * (t / 250 - 1)) }); // -2%/s
  ex.onTick(falling(250));
  ex.onEntry({ t: 250, price: 100, sizeBase: 1e4 });
  ex.onTick(falling(500));
  assert.equal(ex.decide(500).action, 'HOLD');                 // heldMs 250 < 750 grace
  ex.onTick(falling(750));
  assert.equal(ex.decide(750).action, 'HOLD');
  ex.onTick(falling(1000));
  const d = ex.decide(1000);                                   // heldMs 750 hits the grace edge
  assert.equal(d.action, 'SELL_NOW');
  assert.equal(d.reason, 'WEAK_MOMENTUM');
  assert.equal(d.detail.momentum, 'weak');
});

test('neutral chop rides to the deadline and exits TIMER_EXPIRED', () => {
  const ex = create();
  const chop = t => mkTick(t, { trades: [buy(0.5), sell(0.5)] });
  feed(ex, 750, chop);
  ex.onEntry({ t: 750, price: 1e-7, sizeBase: 1e4 });
  for (let t = 1000; t < 4750; t += 250) {
    ex.onTick(chop(t));
    assert.equal(ex.decide(t).action, 'HOLD', 'holding at ' + t);
  }
  ex.onTick(chop(4750));
  const d = ex.decide(4750);                                   // 750 + 4000
  assert.equal(d.action, 'SELL_NOW');
  assert.equal(d.reason, 'TIMER_EXPIRED');
  assert.equal(d.detail.extensionsUsed, 0);
  // latched: asking again keeps returning the same verdict
  assert.equal(ex.decide(5000).reason, 'TIMER_EXPIRED');
});

test('strong momentum extends the hold in steps up to the 10s cap', () => {
  const ex = create();
  // rising price (+2.4%/s), all-buy flow with ramping size => strong on all axes
  const strong = t => mkTick(t, {
    price: 100 * Math.exp(0.006 * (t / 250 - 1)),
    trades: [buy(1 * Math.pow(1.05, t / 250))],
  });
  feed(ex, 1000, strong);
  ex.onEntry({ t: 1000, price: 100, sizeBase: 1e4 });
  const events = [];
  for (let t = 1250; t <= 11250; t += 250) {
    ex.onTick(strong(t));
    const d = ex.decide(t);
    if (d.action !== 'HOLD') events.push({ t, action: d.action, reason: d.reason });
    if (d.action === 'SELL_NOW') break;
  }
  assert.deepEqual(events, [
    { t: 5000, action: 'EXTEND', reason: 'MOMENTUM_EXTEND' },   // deadline -> 6500
    { t: 6500, action: 'EXTEND', reason: 'MOMENTUM_EXTEND' },   // -> 8000
    { t: 8000, action: 'EXTEND', reason: 'MOMENTUM_EXTEND' },   // -> 9500
    { t: 9500, action: 'EXTEND', reason: 'MOMENTUM_EXTEND' },   // -> 11000 (the cap)
    { t: 11000, action: 'SELL_NOW', reason: 'TIMER_EXPIRED' },  // cap reached, momentum ignored
  ]);
});

/* ------------------------- liquidity protection ------------------------ */

test('extreme impact defers a timer exit, then force-sells with a split flag', () => {
  const ex = create();
  const chop = t => mkTick(t, { trades: [buy(0.5), sell(0.5)] });
  feed(ex, 1000, chop);
  ex.onEntry({ t: 1000, price: 1e-7, sizeBase: 2e8 });          // 2e8/1.2e9 = 16.7% impact
  let deferSeen = 0, final = null;
  for (let t = 1250; t <= 7000 && !final; t += 250) {
    ex.onTick(chop(t));
    const d = ex.decide(t);
    if (d.reason === 'IMPACT_DEFER') deferSeen++;
    if (d.action === 'SELL_NOW') final = { t, d };
  }
  assert.ok(deferSeen >= 5, 'deferred for several ticks');      // 5000..6250
  assert.equal(final.t, 6500);                                  // 5000 + 1500 defer budget
  assert.equal(final.d.reason, 'TIMER_EXPIRED');
  assert.equal(final.d.detail.split, true);                     // 16.7% > 15% split threshold
});

test('emergencies ignore the impact gate entirely', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  ex.onEntry({ t: 1000, price: 1e-7, sizeBase: 3e8 });          // 25% impact
  ex.onTick(mkTick(1250, { pool: { base: 1e9, quote: 55 } })); // quote -45% in-window
  const d = ex.decide(1250);
  assert.equal(d.action, 'SELL_NOW');
  assert.equal(d.reason, 'EMERGENCY_LIQUIDITY_PULL');
  assert.ok(d.detail.impactPct > DEFAULT_CFG.maxImpactPct);
});

/* -------------------------- emergency triggers ------------------------- */

function enter(ex, t) { ex.onEntry({ t, price: 1e-7, sizeBase: 1e4 }); }

test('liquidity pull: quote reserve dropping 30%+ inside the window', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  enter(ex, 1000);
  ex.onTick(mkTick(1250, { pool: { base: 1e9, quote: 65 } }));  // -35%
  assert.equal(ex.decide(1250).reason, 'EMERGENCY_LIQUIDITY_PULL');
});

test('whale dump: a 4%+ holder shedding 35%+ of its bag', () => {
  const ex = create();
  const holders = pct => [{ wallet: 'whale1', pct }];
  feed(ex, 1000, t => mkTick(t, { holders: holders(5) }));
  enter(ex, 1000);
  ex.onTick(mkTick(1250, { holders: holders(3), trades: [sell(1, 'whale1')] })); // 5 -> 3 = 40%
  const d = ex.decide(1250);
  assert.equal(d.reason, 'EMERGENCY_WHALE_DUMP');
});

test('whale dump: any single wallet-attributed sell that is whale-scale', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  enter(ex, 1000);
  ex.onTick(mkTick(1250, { trades: [sell(5, 'w9')] }));         // 5/(100+5) = 4.8% of pool
  assert.equal(ex.decide(1250).reason, 'EMERGENCY_WHALE_DUMP');
});

test('whale detection is inert without wallet-attributed trades', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  enter(ex, 1000);
  ex.onTick(mkTick(1250, { trades: [{ side: 'sell', base: 5e7, quote: 5, wallet: null }] }));
  assert.equal(ex.decide(1250).action, 'HOLD');
});

test('contract risk: any risk flag flipping true', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  enter(ex, 1000);
  ex.onTick(mkTick(1250, { flags: Object.assign({}, FLAGS, { mintEnabled: true }) }));
  assert.equal(ex.decide(1250).reason, 'EMERGENCY_CONTRACT_RISK');
});

test('sell restriction: the flag flipping true', () => {
  const ex = create();
  feed(ex, 1000, t => mkTick(t));
  enter(ex, 1000);
  ex.onTick(mkTick(1250, { flags: Object.assign({}, FLAGS, { sellRestricted: true }) }));
  assert.equal(ex.decide(1250).reason, 'EMERGENCY_SELL_RESTRICTED');
});

test('observed honeypot: busy flow with zero sells where sells used to exist', () => {
  const ex = create();
  ex.onTick(mkTick(250, { trades: [sell(0.5)] }));              // sells existed once
  enter(ex, 250);
  let fired = null;
  for (let t = 500; t <= 3000 && !fired; t += 250) {
    ex.onTick(mkTick(t, { trades: [buy(0.5), buy(0.3)] }));     // buys only from here on
    const d = ex.decide(t);
    if (d.action === 'SELL_NOW') fired = { t, reason: d.reason };
  }
  // fires once the old sell ages out of the 2.5s gap window
  assert.deepEqual(fired, { t: 2750, reason: 'EMERGENCY_SELL_RESTRICTED' });
});

test('emergencies only latch while a position is open', () => {
  const ex = create();
  feed(ex, 500, t => mkTick(t));
  ex.onTick(mkTick(750, { pool: { base: 1e9, quote: 40 } }));   // huge pull, but no entry
  const d = ex.decide(750);
  assert.equal(d.action, 'HOLD');
  assert.equal(d.reason, 'HOLDING');
});
