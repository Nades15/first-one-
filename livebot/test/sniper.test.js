/* Sniper entry-filter tests — node --test livebot/test/sniper.test.js. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createSniper } = require('../js/sniper.js');
const { CONFIG } = require('../js/config.js');
const { launchMsg, tradeMsg } = require('./fixtures/messages.js');

function harness(over) {
  const enters = [], skips = [];
  const cfg = JSON.parse(JSON.stringify(CONFIG));
  Object.assign(cfg.SNIPER, over && over.sniper);
  const sniper = createSniper({
    cfg,
    isBlacklisted: (over && over.isBlacklisted) || (() => false),
    canEnter: (over && over.canEnter) || (() => ({ ok: true })),
    onEnter: e => enters.push(e), onSkip: s => skips.push(s),
  });
  return { sniper, enters, skips, cfg };
}

/* Launch a token whose dev bought 1 SOL, then push N buyers each 0.5 SOL. */
function launchWithBuyers(sniper, n, opts) {
  const o = opts || {};
  sniper.onLaunch(launchMsg(Object.assign(
    { mint: 'MINT1', creator: 'DEV', devBuySol: 1.0, devBuyTokens: 30e6, vSol: 31, vTokens: 1.043e9, recvT: o.launchT || 0 },
    o.launch)));
  for (let i = 0; i < n; i++) {
    sniper.onTrade(tradeMsg({ mint: 'MINT1', wallet: 'B' + i, side: 'buy', sol: 0.5, tokens: 1e6, vSol: 33 + i, vTokens: 1.0e9, recvT: 100 + i }));
  }
}

test('a healthy launch ENTERs after the decision delay with value-quoting reasons', () => {
  const { sniper, enters } = harness();
  launchWithBuyers(sniper, 5);                       // 5 buyers, 2.5 SOL inflow, curve ~37
  sniper.evaluate('MINT1', 3000, null, 0);           // past decideAfterMs (2500)
  assert.equal(enters.length, 1);
  assert.ok(enters[0].reasons.some(r => r.startsWith('BUYERS_OK')));
  assert.ok(enters[0].reasons.some(r => r.startsWith('INFLOW_OK')));
});

test('does not decide before the decision delay', () => {
  const { sniper, enters } = harness();
  launchWithBuyers(sniper, 5);
  sniper.evaluate('MINT1', 1000, null, 0);           // < 2500ms
  assert.equal(enters.length, 0);
});

test('blacklisted creator is skipped at launch, never watched', () => {
  const { sniper, skips } = harness({ isBlacklisted: () => true });
  const ok = sniper.onLaunch(launchMsg({ mint: 'MINT1' }));
  assert.equal(ok, false);
  assert.equal(skips[0].reasons[0], 'CREATOR_BLACKLISTED');
  assert.equal(skips[0].watched, false);
});

test('dev buy outside the band is skipped at launch', () => {
  let h = harness();
  assert.equal(h.sniper.onLaunch(launchMsg({ mint: 'MINT1', devBuySol: 0.1 })), false);
  assert.ok(h.skips[0].reasons[0].startsWith('DEV_BUY_TOO_SMALL'));
  h = harness();
  assert.equal(h.sniper.onLaunch(launchMsg({ mint: 'MINT1', devBuySol: 9 })), false);
  assert.ok(h.skips[0].reasons[0].startsWith('DEV_BUY_TOO_LARGE'));
});

test('too few buyers → SKIP with the failing filter after give-up time', () => {
  const { sniper, enters, skips } = harness();
  launchWithBuyers(sniper, 2);                       // only 2 buyers (< 4)
  sniper.evaluate('MINT1', 3000, null, 0);
  assert.equal(enters.length, 0);
  sniper.evaluate('MINT1', 9000, null, 0);           // past giveUpMs (8000)
  assert.equal(skips.length, 1);
  assert.ok(skips[0].reasons.some(r => r.startsWith('FEW_BUYERS')));
});

test('dev holding above the cap blocks entry', () => {
  const { sniper, skips } = harness();
  launchWithBuyers(sniper, 5);
  const holders = [{ wallet: 'DEV', pct: 35 }];      // dev holds 35% > 20%
  sniper.evaluate('MINT1', 3000, holders, 0);
  sniper.evaluate('MINT1', 9000, holders, 0);
  assert.ok(skips[0].reasons.some(r => r.startsWith('DEV_HOLDS')));
});

test('risk manager veto is surfaced as a reason', () => {
  const { sniper, enters, skips } = harness({ canEnter: () => ({ ok: false, reason: 'MAX_CONCURRENT' }) });
  launchWithBuyers(sniper, 5);
  sniper.evaluate('MINT1', 3000, null, 3);
  sniper.evaluate('MINT1', 9000, null, 3);
  assert.equal(enters.length, 0);
  assert.ok(skips[0].reasons.some(r => r === 'RISK_MAX_CONCURRENT'));
});

test('watchlist eviction drops the oldest undecided candidate', () => {
  const { sniper } = harness({ sniper: {} });
  const cfgMax = CONFIG.FEED.maxWatchedTokens;
  for (let i = 0; i < cfgMax; i++) {
    sniper.onLaunch(launchMsg({ mint: 'M' + i, recvT: i }));
  }
  assert.equal(sniper.watchedMints().length, cfgMax);
  sniper.onLaunch(launchMsg({ mint: 'MNEW', recvT: 9999 }));
  assert.equal(sniper.watchedMints().length, cfgMax);
  assert.ok(sniper.has('MNEW'));
  assert.ok(!sniper.has('M0'));                       // oldest evicted
});

test('skip-shadowing yields an outcome record after shadowMs', () => {
  const { sniper } = harness();
  launchWithBuyers(sniper, 2);                        // will be skipped
  sniper.evaluate('MINT1', 9000, null, 0);            // SKIP
  assert.equal(sniper.shadowTick('MINT1', 30000), null);   // before shadowMs (60000)
  const rec = sniper.shadowTick('MINT1', 61000);
  assert.ok(rec);
  assert.equal(rec.mint, 'MINT1');
  assert.equal(rec.buyers, 2);
  assert.ok(!sniper.has('MINT1'));                    // forgotten after shadow closes
});
