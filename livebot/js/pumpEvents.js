/* Livebot — pump.fun Anchor event decoder. Reads the CreateEvent / TradeEvent
 * that the pump.fun program (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P)
 * emits as `Program data: <base64>` log lines. Each blob is an 8-byte Anchor
 * event discriminator (sha256("event:<Name>")[:8]) followed by the borsh-
 * encoded struct. Dependency-free (base58 hand-rolled) so it unit-tests with
 * no node_modules.
 *
 * Field order is taken from the pump.fun IDL:
 *   CreateEvent: name(string) symbol(string) uri(string)
 *                mint(pubkey) bondingCurve(pubkey) user(pubkey)
 *   TradeEvent:  mint(pubkey) solAmount(u64) tokenAmount(u64) isBuy(bool)
 *                user(pubkey) timestamp(i64)
 *                virtualSolReserves(u64) virtualTokenReserves(u64)  [...newer
 *                versions append real reserves + fee fields; we stop here, and
 *                those leading fields have been stable since launch].
 * Amounts are raw: SOL in lamports, tokens in base units (6 decimals). The
 * feed normalizes to whole SOL/tokens. */
'use strict';

const crypto = require('crypto');

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function disc(name) {
  return crypto.createHash('sha256').update('event:' + name).digest().subarray(0, 8);
}
const TRADE_DISC = disc('TradeEvent');
const CREATE_DISC = disc('CreateEvent');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (let z = 0; z < zeros; z++) out += '1';
  for (let k = digits.length - 1; k >= 0; k--) out += B58[digits[k]];
  return out;
}

function makeReader(buf) {
  let o = 0;
  const need = n => { if (o + n > buf.length) throw new Error('overrun'); };
  return {
    u64() { need(8); const v = Number(buf.readBigUInt64LE(o)); o += 8; return v; },
    i64() { need(8); const v = Number(buf.readBigInt64LE(o)); o += 8; return v; },
    bool() { need(1); const v = buf[o] !== 0; o += 1; return v; },
    pubkey() { need(32); const v = base58(buf.subarray(o, o + 32)); o += 32; return v; },
    string() { need(4); const len = buf.readUInt32LE(o); o += 4; need(len); const s = buf.toString('utf8', o, o + len); o += len; return s; },
  };
}

/* Decode one base64 `Program data:` blob. Returns a create/trade object, or
 * null if the discriminator is unknown or the bytes are malformed/truncated. */
function decodeEvent(base64) {
  let buf;
  try { buf = Buffer.from(base64, 'base64'); } catch (e) { return null; }
  if (buf.length < 8) return null;
  const d = buf.subarray(0, 8);
  const body = buf.subarray(8);
  try {
    if (d.equals(TRADE_DISC)) {
      const r = makeReader(body);
      const mint = r.pubkey();
      const solLamports = r.u64();
      const tokenBase = r.u64();
      const isBuy = r.bool();
      const user = r.pubkey();
      r.i64();                                  // timestamp (unused)
      const vSolLamports = r.u64();
      const vTokensBase = r.u64();
      return { type: 'trade', mint, solLamports, tokenBase, isBuy, user, vSolLamports, vTokensBase };
    }
    if (d.equals(CREATE_DISC)) {
      const r = makeReader(body);
      const name = r.string();
      const symbol = r.string();
      const uri = r.string();
      const mint = r.pubkey();
      const bondingCurve = r.pubkey();
      const user = r.pubkey();
      return { type: 'create', name, symbol, uri, mint, bondingCurve, user };
    }
  } catch (e) { return null; }
  return null;
}

module.exports = { decodeEvent, base58, TRADE_DISC, CREATE_DISC, PUMP_PROGRAM_ID };
