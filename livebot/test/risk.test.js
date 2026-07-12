/* Risk manager tests — node --test livebot/test/risk.test.js. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createRisk, HARD_PER_TRADE_CAP_SOL } = require('../js/risk.js');
const { CONFIG } = require('../js/config.js');

/* In-memory store double: only the pieces risk.js touches. */
function fakeStore(trades) {
  let ledger = null;
  const t = trades || [];
  return {
    readLedger: () => ledger,
    writeLedger: l => { ledger = JSON.parse(JSON.stringify(l)); },
    gateStats: () => {
      let paperTrades = 0, paperNetSol = 0;
      for (const x of t) { if (x.mode === 'paper') { paperTrades++; paperNetSol += x.pnlNetSol; } }
      return { paperTrades, paperNetSol };
    },
  };
}

function cfg(over) {
  const c = JSON.parse(JSON.stringify(CONFIG));
  Object.assign(c.RISK, over);
  return c;
}

test('per-trade size is capped at the frozen ceiling in live mode', () => {
  const risk = createRisk({ cfg: cfg({ perTradeCapSol: 0.5 }), store: fakeStore(), live: true });
  assert.equal(risk.perTradeSol(), HARD_PER_TRADE_CAP_SOL);   // config 0.5 ignored, frozen 0.05 wins
});

test('config can LOWER the size below the ceiling', () => {
  const risk = createRisk({ cfg: cfg({ perTradeCapSol: 0.02 }), store: fakeStore(), live: true });
  assert.equal(risk.perTradeSol(), 0.02);
});

test('canEnter rejects a 4th concurrent position', () => {
  const risk = createRisk({ cfg: cfg(), store: fakeStore(), live: false });
  assert.equal(risk.canEnter(2).ok, true);
  assert.equal(risk.canEnter(3).ok, false);
  assert.equal(risk.canEnter(3).reason, 'MAX_CONCURRENT');
});

test('daily net loss past the stop halts entries until UTC rollover', () => {
  let clock = Date.UTC(2026, 6, 12, 12, 0, 0);
  const risk = createRisk({ cfg: cfg(), store: fakeStore(), live: false, now: () => clock });
  risk.settle(-0.10);
  assert.equal(risk.canEnter(0).ok, true);
  risk.settle(-0.051);                          // cumulative -0.151 <= -0.15 stop
  assert.equal(risk.mode(), 'HALTED_DAILY');
  assert.equal(risk.canEnter(0).reason, 'DAILY_STOP');
  clock = Date.UTC(2026, 6, 13, 0, 0, 1);       // next UTC day
  assert.equal(risk.mode(), 'PAPER');           // rolled over, un-halted
  assert.equal(risk.canEnter(0).ok, true);
});

test('go-live gate: needs >=50 trades AND net positive', () => {
  const mk = trades => createRisk({ cfg: cfg(), store: fakeStore(trades), live: false });
  const pos = n => Array.from({ length: n }, () => ({ mode: 'paper', pnlNetSol: 0.001 }));

  assert.equal(mk(pos(49)).gateStatus().unlocked, false);          // too few
  const fifty_neg = pos(49).concat([{ mode: 'paper', pnlNetSol: -0.2 }]);
  assert.equal(mk(fifty_neg).gateStatus().unlocked, false);        // 50 but net negative
  assert.equal(mk(pos(50)).gateStatus().unlocked, true);          // 50 and net positive
});

test('live-mode wallet floor blocks entry when balance too low', async () => {
  const risk = createRisk({
    cfg: cfg(), store: fakeStore(), live: true,
    getBalance: async () => 0.06,               // floor 0.05 + size 0.05 = 0.10 needed
  });
  assert.equal((await risk.canAffordLive(0.05)).ok, false);
  const rich = createRisk({ cfg: cfg(), store: fakeStore(), live: true, getBalance: async () => 1.0 });
  assert.equal((await rich.canAffordLive(0.05)).ok, true);
});

test('panic halts everything', () => {
  const risk = createRisk({ cfg: cfg(), store: fakeStore(), live: false });
  risk.panic();
  assert.equal(risk.mode(), 'HALTED_PANIC');
  assert.equal(risk.canEnter(0).ok, false);
});
