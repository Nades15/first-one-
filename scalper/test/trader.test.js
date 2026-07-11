/* Pulse trader integration tests — run with: node --test scalper/test/trader.test.js
 * Full runs through the real simulator with pinned seeds; scenarios script
 * hard shocks, so assertions target reasons and orderings, not fragile
 * price levels. Entry is at t=1000, so the fixed-timer baseline sells at
 * t=5000. */
const { test } = require('node:test');
const assert = require('node:assert');
const { createRun } = require('../js/trader.js');

function runOut(opts) {
  const run = createRun(Object.assign({ seed: 42 }, opts));
  let guard = 0;
  while (!run.finished() && guard++ < 400) run.step();
  assert.ok(run.finished(), 'run finished');
  return { run, r: run.result() };
}

test('rugPull: liquidity-pull emergency fires the tick the rug lands, beating the baseline', () => {
  const { r } = runOut({ scenarioId: 'rugPull' });
  assert.equal(r.exit.reason, 'EMERGENCY_LIQUIDITY_PULL');
  assert.equal(r.exit.t, 4500);                     // the pull is scripted at 4500
  assert.ok(r.baseline.pnlPct < -90, 'baseline ate the rug: ' + r.baseline.pnlPct);
  assert.ok(r.edgeQuote > 0.3, 'smart exit saved most of the position');
});

test('whaleDump: whale emergency fires mid-dump, before the fixed timer', () => {
  const { r } = runOut({ scenarioId: 'whaleDump' });
  assert.equal(r.exit.reason, 'EMERGENCY_WHALE_DUMP');
  assert.ok(r.exit.t >= 3500 && r.exit.t <= 4250, 'exited during the dump at ' + r.exit.t);
  assert.ok(r.pnlPct > r.baseline.pnlPct);
  assert.ok(r.edgeQuote > 0);
});

test('moonshot: strong momentum extends the hold past the default deadline', () => {
  const { r } = runOut({ scenarioId: 'moonshot' });
  assert.ok(r.extensions.length >= 2, r.extensions.length + ' extensions');
  assert.ok(r.exit.t > 5000, 'held past the 4s default: ' + r.exit.t);
  assert.equal(r.exit.reason, 'TIMER_EXPIRED');     // rode the extended timer out
  assert.ok(r.pnlPct > r.baseline.pnlPct, 'captured more upside than the fixed timer');
});

test('slowBleed: weak momentum exits well before the timer and loses less', () => {
  const { r } = runOut({ scenarioId: 'slowBleed' });
  assert.equal(r.exit.reason, 'WEAK_MOMENTUM');
  assert.ok(r.exit.t < 5000, 'exited early at ' + r.exit.t);
  assert.ok(r.pnlPct >= r.baseline.pnlPct);
});

test('chop: no signal, no events — the default timer fires and edge is zero', () => {
  const { r } = runOut({ scenarioId: 'chop' });
  assert.equal(r.exit.reason, 'TIMER_EXPIRED');
  assert.equal(r.exit.t, 5000);                     // entry 1000 + 4000 default hold
  assert.equal(r.extensions.length, 0);
  // identical worlds selling at the identical tick: exactly no edge
  assert.ok(Math.abs(r.edgeQuote) < 1e-9);
});

test('honeypot: sell restriction is detected and the position honestly written off', () => {
  const { r } = runOut({ scenarioId: 'honeypot' });
  assert.equal(r.exit.reason, 'EMERGENCY_SELL_RESTRICTED');
  assert.equal(r.exit.failed, true);
  assert.equal(r.pnlPct, -100);
  assert.equal(r.baseline.failed, true);            // the dumb timer is just as stuck
  assert.equal(r.baseline.pnlPct, -100);
});

test('oversized position: impact gate defers, then force-sells in tranches', () => {
  const { r, run } = runOut({ scenarioId: 'chop', trade: { buySizeSol: 30, entryDelayMs: 1000 } });
  assert.equal(r.exit.reason, 'TIMER_EXPIRED');
  assert.equal(r.exit.t, 6750);                     // 5000 due + 1500 defer + 2nd tranche tick
  const deferred = run.state().events.length; // events exist; defer visible via exit time
  assert.ok(deferred >= 3);
  assert.ok(r.exit.impactPct < 20, 'split sale beat the single-sale 23% impact: ' + r.exit.impactPct);
});

test('runs are deterministic and the baseline sells at exactly entry + 4s', () => {
  const a = runOut({ scenarioId: 'rugPull' }).r;
  const b = runOut({ scenarioId: 'rugPull' }).r;
  assert.deepEqual(a, b);
  assert.equal(a.entry.t, 1000);
  assert.equal(a.entry.costQuote, 0.5);
  assert.equal(a.baseline.exitT, a.entry.t + 4000);
});

test('exit config overrides flow through (longer base hold)', () => {
  const { r } = runOut({ scenarioId: 'chop', exitCfg: { baseHoldMs: 6000 } });
  assert.equal(r.exit.reason, 'TIMER_EXPIRED');
  assert.equal(r.exit.t, 7000);                     // entry 1000 + 6000
  assert.equal(r.baseline.exitT, 7000);             // baseline uses the same base hold
});
