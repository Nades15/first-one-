/* Feed adapter tests — node --test livebot/test/feed.test.js. Zero network. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeMsg, createTickBuilder, createWsSource, createReplaySource, createHolderPoller,
} = require('../js/feed.js');
const { LAUNCH, trade } = require('./fixtures/messages.js');

/* ------------------------------ normalizer ------------------------------ */

test('normalizes a create message into a launch', () => {
  const m = normalizeMsg(LAUNCH, 1000);
  assert.equal(m.kind, 'launch');
  assert.equal(m.mint, 'MINT1');
  assert.equal(m.creator, 'DEV');
  assert.equal(m.devBuySol, 1.0);
  assert.equal(m.devBuyTokens, 30e6);
  assert.equal(m.vSol, 31.0);
  assert.equal(m.vTokens, 1.043e9);
});

test('normalizes buy and sell trades', () => {
  const b = normalizeMsg(trade({ txType: 'buy', solAmount: 0.05, tokenAmount: 1.6e6, newTokenBalance: 1.6e6 }), 1200);
  assert.equal(b.kind, 'trade');
  assert.equal(b.side, 'buy');
  assert.equal(b.sol, 0.05);
  assert.equal(b.tokens, 1.6e6);
  assert.equal(b.walletNewBalance, 1.6e6);
  const s = normalizeMsg(trade({ txType: 'sell' }), 1300);
  assert.equal(s.side, 'sell');
});

test('missing required fields become unknown (schema-drift safety)', () => {
  assert.equal(normalizeMsg({ txType: 'buy', mint: 'M' }, 1).kind, 'unknown');       // no reserves/amounts
  assert.equal(normalizeMsg({ txType: 'create', name: 'x' }, 1).kind, 'unknown');    // no mint/reserves
  assert.equal(normalizeMsg({ txType: 'weird', mint: 'M' }, 1).kind, 'unknown');
  assert.equal(normalizeMsg(null, 1).kind, 'unknown');
});

/* ------------------------------ TickBuilder ----------------------------- */

test('TickBuilder aggregates a window of trades into one tick', () => {
  const tb = createTickBuilder({ supply: 1e9, devWallet: 'DEV' });
  tb.note(normalizeMsg(LAUNCH, 0));
  tb.note(normalizeMsg(trade({ traderPublicKey: 'W1', txType: 'buy', solAmount: 0.05, tokenAmount: 1.5e6, newTokenBalance: 1.5e6, vSolInBondingCurve: 31.05, vTokensInBondingCurve: 1.042e9 }), 50));
  tb.note(normalizeMsg(trade({ traderPublicKey: 'W2', txType: 'sell', solAmount: 0.02, tokenAmount: 6e5, newTokenBalance: 0, vSolInBondingCurve: 31.03, vTokensInBondingCurve: 1.0425e9 }), 120));
  const tick = tb.flush(250);
  assert.equal(tick.t, 250);
  assert.equal(tick.trades.length, 2);
  assert.equal(tick.trades[0].side, 'buy');
  assert.equal(tick.trades[0].quote, 0.05);
  // price from the LAST trade's reserves
  assert.ok(Math.abs(tick.price - 31.03 / 1.0425e9) < 1e-30);
  assert.deepEqual(tick.pool, { base: 1.0425e9, quote: 31.03 });
  // next flush has no trades but keeps the last pool sample
  const quiet = tb.flush(500);
  assert.equal(quiet.trades.length, 0);
  assert.deepEqual(quiet.pool, { base: 1.0425e9, quote: 31.03 });
});

test('holders are derived from the stream with dev seeded from the launch', () => {
  const tb = createTickBuilder({ supply: 1e9, devWallet: 'DEV' });
  tb.note(normalizeMsg(LAUNCH, 0));                                   // dev holds 30e6 = 3%
  tb.note(normalizeMsg(trade({ traderPublicKey: 'W1', newTokenBalance: 50e6 }), 40)); // 5%
  const tick = tb.flush(250);
  const byW = {};
  for (const h of tick.holders) byW[h.wallet] = h.pct;
  assert.ok(Math.abs(byW.W1 - 5) < 1e-9);
  assert.ok(Math.abs(byW.DEV - 3) < 1e-9);
  assert.equal(tick.holders[0].wallet, 'W1');                        // sorted desc
});

test('flags default clean and only known flags can be set', () => {
  const tb = createTickBuilder({ supply: 1e9 });
  tb.note(normalizeMsg(LAUNCH, 0));
  let tick = tb.flush(250);
  assert.deepEqual(tick.flags, { sellRestricted: false, mintEnabled: false, lpUnlocked: false, blacklistRisk: false });
  tb.setFlag('mintEnabled', true);
  tb.setFlag('bogus', true);
  tick = tb.flush(500);
  assert.equal(tick.flags.mintEnabled, true);
  assert.equal(tick.flags.bogus, undefined);
});

test('RPC holder corrector overrides stream-derived holders when set', () => {
  const tb = createTickBuilder({ supply: 1e9 });
  tb.note(normalizeMsg(LAUNCH, 0));
  tb.setHolders([{ wallet: 'WHALE', pct: 9 }]);
  assert.equal(tb.flush(250).holders[0].wallet, 'WHALE');
  tb.setHolders(null);
  assert.notEqual((tb.flush(500).holders[0] || {}).wallet, 'WHALE');
});

/* ------------------------------ ws source ------------------------------- */

test('ws source resubscribes to new-token and token streams on open', () => {
  const sent = [];
  let handlers = {};
  class FakeWS {
    constructor() { this.readyState = 1; FakeWS.last = this; }
    send(s) { sent.push(JSON.parse(s)); }
    close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  }
  const src = createWsSource({ url: 'ws://x', WebSocketImpl: FakeWS, onMessage: () => {} });
  src.start();
  FakeWS.last.onopen();                     // initial connect
  src.subscribeNewToken();
  src.subscribeToken('MINT1');
  sent.length = 0;
  FakeWS.last.onopen();                     // simulate reconnect → replays desired subs
  const methods = sent.map(m => m.method);
  assert.ok(methods.includes('subscribeNewToken'));
  const tokenSub = sent.find(m => m.method === 'subscribeTokenTrade');
  assert.deepEqual(tokenSub.keys, ['MINT1']);
});

/* ---------------------------- replay source ----------------------------- */

test('replay drives ticks deterministically from recorded arrival times', () => {
  const lines = [
    { recvT: 1000, raw: LAUNCH },
    { recvT: 1050, raw: trade({ traderPublicKey: 'W1', solAmount: 0.05, tokenAmount: 1.5e6, newTokenBalance: 1.5e6 }) },
    { recvT: 1300, raw: trade({ traderPublicKey: 'W2', txType: 'sell', solAmount: 0.02, tokenAmount: 6e5, newTokenBalance: 0 }) },
  ];
  function runOnce() {
    const tb = createTickBuilder({ supply: 1e9, devWallet: 'DEV' });
    const ticks = [];
    const rp = createReplaySource(lines, {
      tickMs: 250,
      onMessage: (raw, recvT) => tb.note(normalizeMsg(raw, recvT)),
      onTick: (t) => ticks.push(tb.flush(t)),
    });
    rp.run();
    return ticks;
  }
  const a = runOnce(), b = runOnce();
  assert.deepEqual(a, b);                    // byte-identical reruns
  assert.ok(a.length >= 2);
  // first 250ms window (t=250) holds the launch + first buy; the sell (rel 300) lands in a later tick
  const firstWithTrades = a.find(t => t.trades.length);
  assert.equal(firstWithTrades.trades[0].wallet, 'W1');
});

/* ---------------------------- holder poller ----------------------------- */

test('holder poller throttles and maps largest accounts to pct', async () => {
  let calls = 0;
  const poller = createHolderPoller({
    intervalMs: 2000, supply: 1e9,
    rpcCall: async () => { calls++; return { value: [{ address: 'A', uiAmount: 80e6 }, { address: 'B', uiAmount: 20e6 }] }; },
  });
  const first = await poller.poll('MINT1');
  assert.equal(calls, 1);
  assert.equal(first[0].wallet, 'A');
  assert.ok(Math.abs(first[0].pct - 8) < 1e-9);
  assert.equal(await poller.poll('MINT1'), null);   // throttled inside the interval
  assert.equal(calls, 1);
});
