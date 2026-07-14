/* Spot feed normalizers — node --test fairline/test/spot.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeCoinbase, normalizeBinance } = require('../js/spot.js');

const CB = { 'BTC-USD': 'BTC', 'ETH-USD': 'ETH' };
const BN = { btcusdt: 'BTC', ethusdt: 'ETH' };

test('coinbase match messages normalize; everything else is null', () => {
  assert.deepEqual(normalizeCoinbase({ type: 'match', product_id: 'BTC-USD', price: '118000.5' }, CB),
    { asset: 'BTC', price: 118000.5 });
  assert.deepEqual(normalizeCoinbase({ type: 'last_match', product_id: 'ETH-USD', price: '3600' }, CB),
    { asset: 'ETH', price: 3600 });
  assert.equal(normalizeCoinbase({ type: 'subscriptions' }, CB), null);
  assert.equal(normalizeCoinbase({ type: 'match', product_id: 'DOGE-USD', price: '1' }, CB), null);
  assert.equal(normalizeCoinbase({ type: 'match', product_id: 'BTC-USD', price: '-5' }, CB), null);
  assert.equal(normalizeCoinbase(null, CB), null);
});

test('binance trade stream messages normalize; everything else is null', () => {
  assert.deepEqual(normalizeBinance({ stream: 'btcusdt@trade', data: { e: 'trade', p: '118000.5' } }, BN),
    { asset: 'BTC', price: 118000.5 });
  assert.equal(normalizeBinance({ stream: 'btcusdt@depth', data: { e: 'depthUpdate' } }, BN), null);
  assert.equal(normalizeBinance({ stream: 'dogeusdt@trade', data: { e: 'trade', p: '1' } }, BN), null);
  assert.equal(normalizeBinance({}, BN), null);
});
