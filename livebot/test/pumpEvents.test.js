/* pump.fun event decoder tests — node --test livebot/test/pumpEvents.test.js.
 * Builds event blobs to the IDL layout, then checks the decoder reads them
 * back. Dependency-free. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decodeEvent, base58, TRADE_DISC, CREATE_DISC } = require('../js/pumpEvents.js');

/* ---- tiny borsh encoders mirroring the layouts (test-side only) ---- */
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function str(s) { const sb = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32LE(sb.length); return Buffer.concat([len, sb]); }
function pk(byte) { return Buffer.alloc(32, byte); }   // 32 bytes of one value
const b64 = buf => buf.toString('base64');

test('base58 encodes 32 zero bytes to the System Program address', () => {
  assert.equal(base58(Buffer.alloc(32, 0)), '11111111111111111111111111111111');
});

test('discriminators are 8 bytes and distinct', () => {
  assert.equal(TRADE_DISC.length, 8);
  assert.equal(CREATE_DISC.length, 8);
  assert.ok(!TRADE_DISC.equals(CREATE_DISC));
});

test('decodes a TradeEvent in IDL field order', () => {
  const body = Buffer.concat([
    pk(1),                 // mint
    u64(50_000_000),       // solAmount = 0.05 SOL in lamports
    u64(1_600_000_000),    // tokenAmount = 1600 tokens (6 decimals)
    Buffer.from([1]),      // isBuy = true
    pk(2),                 // user
    i64(1_700_000_000),    // timestamp
    u64(31_050_000_000),   // virtualSolReserves = 31.05 SOL
    u64(1_042_000_000_000_000), // virtualTokenReserves
  ]);
  const ev = decodeEvent(b64(Buffer.concat([TRADE_DISC, body])));
  assert.equal(ev.type, 'trade');
  assert.equal(ev.mint, base58(pk(1)));
  assert.equal(ev.solLamports, 50_000_000);
  assert.equal(ev.tokenBase, 1_600_000_000);
  assert.equal(ev.isBuy, true);
  assert.equal(ev.user, base58(pk(2)));
  assert.equal(ev.vSolLamports, 31_050_000_000);
  assert.equal(ev.vTokensBase, 1_042_000_000_000_000);
});

test('decodes a sell TradeEvent (isBuy=false)', () => {
  const body = Buffer.concat([
    pk(3), u64(20_000_000), u64(600_000_000), Buffer.from([0]), pk(4),
    i64(1), u64(31_000_000_000), u64(1_043_000_000_000_000),
  ]);
  const ev = decodeEvent(b64(Buffer.concat([TRADE_DISC, body])));
  assert.equal(ev.isBuy, false);
  assert.equal(ev.solLamports, 20_000_000);
});

test('tolerates newer TradeEvents with extra trailing fields', () => {
  const body = Buffer.concat([
    pk(1), u64(1), u64(2), Buffer.from([1]), pk(2), i64(0), u64(30_000_000_000), u64(1_073_000_000_000_000),
    u64(999), u64(888), pk(5),   // real reserves + creator etc. that newer versions append
  ]);
  const ev = decodeEvent(b64(Buffer.concat([TRADE_DISC, body])));
  assert.equal(ev.type, 'trade');
  assert.equal(ev.vTokensBase, 1_073_000_000_000_000);   // leading fields still read correctly
});

test('decodes a CreateEvent', () => {
  const body = Buffer.concat([str('Zeta Token'), str('ZETA'), str('ipfs://z'), pk(7), pk(8), pk(9)]);
  const ev = decodeEvent(b64(Buffer.concat([CREATE_DISC, body])));
  assert.equal(ev.type, 'create');
  assert.equal(ev.name, 'Zeta Token');
  assert.equal(ev.symbol, 'ZETA');
  assert.equal(ev.uri, 'ipfs://z');
  assert.equal(ev.mint, base58(pk(7)));
  assert.equal(ev.user, base58(pk(9)));
});

test('unknown discriminator and truncated data return null', () => {
  assert.equal(decodeEvent(b64(Buffer.concat([Buffer.alloc(8, 0xAB), pk(1)]))), null);   // wrong disc
  assert.equal(decodeEvent(b64(Buffer.concat([TRADE_DISC, pk(1)]))), null);              // truncated body
  assert.equal(decodeEvent('not base64 %%%'), null);
  assert.equal(decodeEvent(''), null);
});
