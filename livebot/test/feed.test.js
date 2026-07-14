/* Feed adapter tests (Helius) — node --test livebot/test/feed.test.js. Zero network. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  decodeNotification, createTickBuilder, createWsSource, createReplaySource, createHolderPoller,
} = require('../js/feed.js');
const { launchNotif, tradeNotif, launchMsg, tradeMsg, addr } = require('./fixtures/messages.js');

/* --------------------- notification → normalized messages -------------------- */

test('a launch notification folds the dev buy into one launch message', () => {
  const msgs = decodeNotification(launchNotif({ mint: 'MINTZ', creator: 'DEV', devBuySol: 1.0, devBuyTokens: 30e6, vSol: 31, vTokens: 1.043e9 }), 1000);
  assert.equal(msgs.length, 1);                         // dev buy is folded in, not a separate trade
  const m = msgs[0];
  assert.equal(m.kind, 'launch');
  assert.equal(m.mint, addr('MINTZ'));
  assert.equal(m.creator, addr('DEV'));
  assert.equal(m.name, 'Zeta');
  assert.equal(m.symbol, 'ZETA');
  assert.ok(Math.abs(m.devBuySol - 1.0) < 1e-9);
  assert.ok(Math.abs(m.devBuyTokens - 30e6) < 1);
  assert.ok(Math.abs(m.vSol - 31) < 1e-9);
  assert.ok(Math.abs(m.vTokens - 1.043e9) < 1);
});

test('a trade notification decodes to one trade message with lamports/base normalized', () => {
  const [m] = decodeNotification(tradeNotif({ mint: 'MINTZ', wallet: 'W1', side: 'buy', sol: 0.05, tokens: 1.6e6, vSol: 31.05, vTokens: 1.042e9 }), 1200);
  assert.equal(m.kind, 'trade');
  assert.equal(m.side, 'buy');
  assert.equal(m.wallet, addr('W1'));
  assert.ok(Math.abs(m.sol - 0.05) < 1e-9);             // lamports → SOL
  assert.ok(Math.abs(m.tokens - 1.6e6) < 1);           // base → whole tokens
  assert.ok(Math.abs(m.vSol - 31.05) < 1e-6);
  assert.equal(m.walletNewBalance, null);
  const [s] = decodeNotification(tradeNotif({ side: 'sell', sol: 0.02, vSol: 31, vTokens: 1.043e9 }), 1300);
  assert.equal(s.side, 'sell');
});

test('failed transactions and non-pump notifications yield nothing', () => {
  assert.deepEqual(decodeNotification(tradeNotif({ sol: 1, vSol: 31, vTokens: 1e9, err: { InstructionError: [0, 'x'] } }), 1), []);
  assert.deepEqual(decodeNotification({ params: { result: { value: { logs: ['Program log: hi'], err: null } } } }, 1), []);
  assert.deepEqual(decodeNotification({ result: 12345, id: 1 }, 1), []);   // subscription confirmation
});

/* ------------------------------ TickBuilder ----------------------------- */

test('TickBuilder aggregates trades and keeps a running holder balance', () => {
  const tb = createTickBuilder({ supply: 1e9, devWallet: 'DEV' });
  tb.note(launchMsg({ creator: 'DEV', devBuyTokens: 30e6 }));         // dev seeded at 3%
  tb.note(tradeMsg({ wallet: 'W1', side: 'buy', tokens: 50e6, sol: 1, vSol: 32, vTokens: 1.02e9 }));  // +5%
  tb.note(tradeMsg({ wallet: 'W1', side: 'sell', tokens: 20e6, sol: 0.4, vSol: 31.6, vTokens: 1.03e9 })); // -2% → net 3%
  const tick = tb.flush(250);
  assert.equal(tick.trades.length, 2);
  assert.deepEqual(tick.pool, { base: 1.03e9, quote: 31.6 });         // last trade's reserves
  const byW = {};
  for (const h of tick.holders) byW[h.wallet] = h.pct;
  assert.ok(Math.abs(byW.W1 - 3) < 1e-6, 'running balance 50-20=30M = 3%');
  assert.ok(Math.abs(byW.DEV - 3) < 1e-6);
});

test('quiet ticks repeat the last pool sample', () => {
  const tb = createTickBuilder({ supply: 1e9 });
  tb.note(launchMsg());
  tb.flush(250);
  const quiet = tb.flush(500);
  assert.equal(quiet.trades.length, 0);
  assert.ok(quiet.pool.quote > 0);
});

test('RPC holder corrector overrides stream-derived holders when set', () => {
  const tb = createTickBuilder({ supply: 1e9 });
  tb.note(launchMsg());
  tb.setHolders([{ wallet: 'WHALE', pct: 9 }]);
  assert.equal(tb.flush(250).holders[0].wallet, 'WHALE');
  tb.setHolders(null);
  assert.notEqual((tb.flush(500).holders[0] || {}).wallet, 'WHALE');
});

/* ------------------------------ ws source ------------------------------- */

test('ws source sends a single logsSubscribe for the pump program on open', () => {
  const sent = [];
  class FakeWS {
    constructor() { this.readyState = 1; FakeWS.last = this; }
    send(s) { sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const src = createWsSource({ url: 'wss://x', programId: 'PUMP', WebSocketImpl: FakeWS, onMessage: () => {} });
  src.start();
  FakeWS.last.onopen();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'logsSubscribe');
  assert.deepEqual(sent[0].params[0], { mentions: ['PUMP'] });
});

/* ---------------------------- replay source ----------------------------- */

test('replay drives ticks deterministically from recorded notifications', () => {
  const lines = [
    { recvT: 1000, raw: launchNotif({ mint: 'MINTZ', creator: 'DEV' }) },
    { recvT: 1050, raw: tradeNotif({ mint: 'MINTZ', wallet: 'W1', side: 'buy', sol: 0.5, tokens: 1.5e6, vSol: 31.5, vTokens: 1.04e9 }) },
    { recvT: 1300, raw: tradeNotif({ mint: 'MINTZ', wallet: 'W2', side: 'sell', sol: 0.2, tokens: 6e5, vSol: 31.3, vTokens: 1.045e9 }) },
  ];
  function runOnce() {
    const tb = createTickBuilder({ supply: 1e9, devWallet: addr('DEV') });
    const ticks = [];
    createReplaySource(lines, {
      tickMs: 250,
      onMessage: (raw, recvT) => { for (const m of decodeNotification(raw, recvT)) tb.note(m); },
      onTick: (t) => ticks.push(tb.flush(t)),
    }).run();
    return ticks;
  }
  assert.deepEqual(runOnce(), runOnce());               // byte-identical reruns
});

/* ---------------------------- holder poller ----------------------------- */

test('holder poller throttles and maps largest accounts to pct', async () => {
  let calls = 0;
  const poller = createHolderPoller({
    intervalMs: 2000, supply: 1e9,
    rpcCall: async () => { calls++; return { value: [{ address: 'A', uiAmount: 80e6 }, { address: 'B', uiAmount: 20e6 }] }; },
  });
  const first = await poller.poll('MINTZ');
  assert.equal(calls, 1);
  assert.equal(first[0].wallet, 'A');
  assert.ok(Math.abs(first[0].pct - 8) < 1e-9);
  assert.equal(await poller.poll('MINTZ'), null);       // throttled inside the interval
});
