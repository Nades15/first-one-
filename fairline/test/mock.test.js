/* Mock world + virtual-clock sim — node --test fairline/test/mock.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createMockWorld, runVirtual } = require('../js/mock.js');
const { createPipeline } = require('../js/pipeline.js');
const { createPaperBroker } = require('../js/paperBroker.js');
const { createRisk } = require('../js/risk.js');
const { testCfg, tempStore } = require('./helpers.js');

function simOnce(seed, targetSettles) {
  const cfg = testCfg({ RISK: { dailyStopUsd: 1000 } });   // research run — no self-halt
  const store = tempStore();
  let simT = 0;
  const risk = createRisk({ cfg, store, now: () => simT });
  const pipe = createPipeline({ cfg, store, risk, broker: createPaperBroker(cfg) });
  const res = runVirtual(createMockWorld({ seed }), pipe, {
    tickMs: cfg.ENGINE.tickMs,
    onTime: t => { simT = t; },
    until: t => pipe.snapshot(t).stats.settles >= targetSettles,
    maxSimMs: 12 * 3600e3,
  });
  return { trades: store.allTrades(), res };
}

test('virtual sim reaches the settle target and is deterministic per seed', () => {
  const a = simOnce(7, 5);
  const b = simOnce(7, 5);
  const settled = a.trades.filter(t => t.won != null);
  assert.ok(settled.length >= 5, 'reached ' + settled.length + ' settles');
  assert.ok(a.res.simMs < 12 * 3600e3, 'finished before the cap');
  assert.deepEqual(a.trades, b.trades);                    // byte-for-byte identical
});

test('different seeds produce different tapes', () => {
  const a = simOnce(7, 5);
  const b = simOnce(8, 5);
  assert.notDeepEqual(a.trades.map(t => t.pnlNetUsd), b.trades.map(t => t.pnlNetUsd));
});

test('mock world generators are pure per seed', () => {
  const w1 = createMockWorld({ seed: 3 });
  const w2 = createMockWorld({ seed: 3 });
  assert.deepEqual(w1.stepSpot(1), w2.stepSpot(1));
  assert.deepEqual(w1.makeMarkets(1000, 3), w2.makeMarkets(1000, 3));
});
