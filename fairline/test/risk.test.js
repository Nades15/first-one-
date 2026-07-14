/* Risk manager — node --test fairline/test/risk.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRisk, HARD_PER_TRADE_CAP_USD } = require('../js/risk.js');
const { makeCfg } = require('./helpers.js');

/* In-memory store double: only the pieces risk.js touches. */
function fakeStore(trades) {
  let ledger = null;
  const t = trades || [];
  return {
    readLedger: () => ledger,
    writeLedger: l => { ledger = JSON.parse(JSON.stringify(l)); },
    gateStats: () => {
      let paperTrades = 0, paperNetUsd = 0;
      for (const x of t) { if (x.mode === 'paper') { paperTrades++; paperNetUsd += x.pnlNetUsd; } }
      return { paperTrades, paperNetUsd };
    },
  };
}

test('stake is capped at the frozen ceiling', () => {
  const risk = createRisk({ cfg: makeCfg({ RISK: { perTradeCapUsd: 500 } }), store: fakeStore() });
  assert.equal(risk.perTradeUsd(), HARD_PER_TRADE_CAP_USD);
  const lower = createRisk({ cfg: makeCfg({ RISK: { perTradeCapUsd: 2 } }), store: fakeStore() });
  assert.equal(lower.perTradeUsd(), 2);
});

test('canEnter enforces max concurrency (pending entries count)', () => {
  const risk = createRisk({ cfg: makeCfg({ RISK: { maxConcurrent: 3 } }), store: fakeStore() });
  assert.equal(risk.canEnter(2).ok, true);
  assert.equal(risk.canEnter(3).ok, false);
  assert.equal(risk.canEnter(3).reason, 'MAX_CONCURRENT');
});

test('daily loss stop halts entries until UTC rollover', () => {
  let clock = Date.UTC(2026, 6, 14, 12, 0, 0);
  const risk = createRisk({ cfg: makeCfg({ RISK: { dailyStopUsd: 30 } }),
    store: fakeStore(), now: () => clock });
  risk.settle(-20);
  assert.equal(risk.canEnter(0).ok, true);
  risk.settle(-10.5);                            // cumulative −30.5 ≤ −30
  assert.equal(risk.mode(), 'HALTED_DAILY');
  assert.equal(risk.canEnter(0).reason, 'DAILY_STOP');
  clock = Date.UTC(2026, 6, 15, 0, 0, 1);
  assert.equal(risk.mode(), 'PAPER');
  assert.equal(risk.canEnter(0).ok, true);
});

test('gate needs BOTH the trade count and net-positive PnL', () => {
  const mk = trades => createRisk({ cfg: makeCfg({ RISK: { gateMinTrades: 100 } }),
    store: fakeStore(trades) });
  const wins = n => Array.from({ length: n }, () => ({ mode: 'paper', pnlNetUsd: 0.5 }));
  assert.equal(mk(wins(99)).gateStatus().unlocked, false);                       // count short
  assert.equal(mk(wins(100)).gateStatus().unlocked, true);
  const losers = wins(100).concat([{ mode: 'paper', pnlNetUsd: -100 }]);
  assert.equal(mk(losers).gateStatus().unlocked, false);                         // net negative
});

test('panic halts everything until restart', () => {
  const risk = createRisk({ cfg: makeCfg(), store: fakeStore() });
  risk.panic();
  assert.equal(risk.mode(), 'HALTED_PANIC');
  assert.equal(risk.canEnter(0).reason, 'PANIC');
});
