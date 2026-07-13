/* Paper broker tests — node --test livebot/test/paperBroker.test.js. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createPaperBroker } = require('../js/paperBroker.js');
const { computeFees } = require('../js/broker.js');
const { amm } = require('../../scalper/js/sim.js');

const CFG = {
  FEES: { pumpFeePct: 1.0, portalFeePct: 0.5, priorityFeeSol: 0.0003, networkFeeSol: 0.000005 },
  TRADE: { paperLatencyMs: 400 },
};
const tick = (t, pool) => ({ t, pool });

test('computeFees itemizes the full stack', () => {
  const f = computeFees(0.05, CFG.FEES);
  assert.equal(f.platform, 0.0005);         // 1%
  assert.equal(f.portal, 0.00025);          // 0.5%
  assert.equal(f.priority, 0.0003);
  assert.equal(f.network, 0.000005);
  assert.equal(f.total, 0.001055);
});

test('buy fill: fees skimmed before the curve, exact AMM baseOut', () => {
  const b = createPaperBroker(CFG);
  const pool = { base: 1.073e9, quote: 30 };
  const id = b.request('buy', 'M', 0.05, { tick: tick(1000, pool) });
  assert.equal(id, 1);
  // not filled until decision time + latency (1400)
  assert.equal(b.onTick('M', tick(1250, pool)).length, 0);
  const [res] = b.onTick('M', tick(1500, pool));
  assert.ok(res.ok);
  const curveIn = 0.05 - 0.0005 - 0.00025;
  const expectBase = amm.buy({ base: 1.073e9, quote: 30 }, curveIn);
  assert.ok(Math.abs(res.baseOut - expectBase) < 1e-3);
  assert.equal(res.solSpent, 0.050305);     // 0.05 + priority + network
});

test('flat-price round trip loses ~4.5% to fees at a 0.05 SOL size', () => {
  // At this tiny size the flat priority fee (0.0003 SOL ≈ 0.6%/side) dominates
  // on top of the 3% percentage fees — the honest round-trip cost is ~4.5%,
  // NOT the ~3% you'd guess from percentages alone. This is why the gate bar
  // (net positive after fees) is hard to clear.
  const b = createPaperBroker(CFG);
  const pool = { base: 1.073e9, quote: 30 };
  b.request('buy', 'M', 0.05, { tick: tick(1000, pool) });
  const [buy] = b.onTick('M', tick(1400, pool));
  b.request('sell', 'M', buy.baseOut, { tick: tick(2000, pool) });
  const [sell] = b.onTick('M', tick(2400, pool));
  const pct = (sell.solOutNet - buy.solSpent) / buy.solSpent * 100;
  assert.ok(pct < -4.0 && pct > -5.0, 'round trip pct = ' + pct.toFixed(3));
});

test('latency window: a dump before our SELL fill worsens the exit', () => {
  // The case that matters: our exit lags a dump. A sell decided against a good
  // pool but filled 400ms later against a dumped pool nets less SOL.
  const good = { base: 1.073e9, quote: 30 };
  const dumped = { base: 1.20e9, quote: 26.8 };     // price fell in the latency window
  const size = 2e6;
  const b = createPaperBroker(CFG);
  b.request('sell', 'M', size, { tick: tick(1000, good) });
  b.onTick('M', tick(1000, good));
  const [filled] = b.onTick('M', tick(1450, dumped));    // fill lands against the dumped pool
  const noLatency = createPaperBroker(CFG);
  noLatency.request('sell', 'M', size, { tick: tick(1000, good) });
  const [ideal] = noLatency.onTick('M', tick(1450, good));
  assert.ok(filled.solOutNet < ideal.solOutNet, 'dumped exit should net less SOL');
});

test('selling into a dead pool is a NO_LIQUIDITY write-off', () => {
  const b = createPaperBroker(CFG);
  b.request('sell', 'M', 1e6, { tick: tick(1000, { base: 1e9, quote: 30 }) });
  const [res] = b.onTick('M', tick(1500, { base: 0, quote: 0 }));
  assert.equal(res.ok, false);
  assert.equal(res.failReason, 'NO_LIQUIDITY');
});
