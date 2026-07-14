/* Test fixtures for the Helius feed. Two layers:
 *   - normalized-message builders (launchMsg/tradeMsg) — the shapes the
 *     pipeline routes; used by sniper/TickBuilder tests.
 *   - Helius-notification builders (launchNotif/tradeNotif) — real
 *     logsNotification objects with borsh-encoded pump.fun events; used by the
 *     feed decode tests and the session-fixture generator.
 * Wallet/mint labels map to deterministic 32-byte keys so tests can assert on
 * base58 addresses via addr('LABEL'). */
'use strict';
const crypto = require('crypto');
const { TRADE_DISC, CREATE_DISC, base58 } = require('../../js/pumpEvents.js');

/* deterministic 32-byte key for a label, and its base58 address */
function pkFor(label) { return crypto.createHash('sha256').update('key:' + label).digest().subarray(0, 32); }
function addr(label) { return base58(pkFor(label)); }

/* ---- borsh encoders mirroring the IDL layouts ---- */
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(Math.round(n))); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(Math.round(n))); return b; }
function vstr(s) { const sb = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32LE(sb.length); return Buffer.concat([len, sb]); }

function encodeCreate(o) {
  return Buffer.concat([CREATE_DISC,
    vstr(o.name || 'Tok'), vstr(o.symbol || 'TOK'), vstr(o.uri || 'ipfs://x'),
    pkFor(o.mint), pkFor(o.bondingCurve || (o.mint + '-bc')), pkFor(o.user)]);
}
function encodeTrade(o) {
  return Buffer.concat([TRADE_DISC,
    pkFor(o.mint), u64((o.sol) * 1e9), u64((o.tokens) * 1e6), Buffer.from([o.isBuy ? 1 : 0]),
    pkFor(o.user), i64(o.ts || 1_700_000_000), u64((o.vSol) * 1e9), u64((o.vTokens) * 1e6)]);
}
const progData = buf => 'Program data: ' + buf.toString('base64');

function notif(logs, over) {
  const o = over || {};
  return {
    jsonrpc: '2.0', method: 'logsNotification',
    params: { subscription: 1, result: {
      context: { slot: o.slot || 1 },
      value: { signature: o.signature || 'sig', err: o.err || null, logs },
    } },
  };
}

/* A launch tx: CreateEvent + the dev's initial buy in the same logs. */
function launchNotif(o) {
  o = o || {};
  const mint = o.mint || 'MINTZ', user = o.creator || 'DEV';
  const logs = [
    'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
    progData(encodeCreate({ name: o.name || 'Zeta', symbol: o.symbol || 'ZETA', uri: o.uri, mint, user })),
    progData(encodeTrade({ mint, sol: o.devBuySol != null ? o.devBuySol : 1.0, tokens: o.devBuyTokens != null ? o.devBuyTokens : 30e6,
      isBuy: true, user, vSol: o.vSol || 31, vTokens: o.vTokens || 1.043e9 })),
    'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P success',
  ];
  return notif(logs, { signature: o.sig || ('create-' + mint) });
}

/* A single trade tx. */
function tradeNotif(o) {
  return notif([progData(encodeTrade({
    mint: o.mint || 'MINTZ', sol: o.sol, tokens: o.tokens != null ? o.tokens : 1e6,
    isBuy: o.side !== 'sell', user: o.wallet || 'W1', vSol: o.vSol, vTokens: o.vTokens,
  }))], { signature: o.sig || 'trade', err: o.err || null });
}

/* ---- normalized-message builders (post-decode shapes) ---- */
function launchMsg(over) {
  return Object.assign({
    kind: 'launch', recvT: 0, mint: 'MINTZ', creator: 'DEV', name: 'Zeta', symbol: 'ZETA', uri: 'ipfs://z',
    devBuySol: 1.0, devBuyTokens: 30e6, vSol: 31, vTokens: 1.043e9, sig: 'create',
  }, over);
}
function tradeMsg(over) {
  return Object.assign({
    kind: 'trade', recvT: 0, mint: 'MINTZ', side: 'buy', wallet: 'W1',
    sol: 0.5, tokens: 1.5e6, walletNewBalance: null, vSol: 31.5, vTokens: 1.04e9, sig: 'trade',
  }, over);
}

module.exports = {
  pkFor, addr, encodeCreate, encodeTrade, progData, notif,
  launchNotif, tradeNotif, launchMsg, tradeMsg,
};
