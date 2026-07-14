/* Order-book normalizers — node --test fairline/test/books.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizePolymarketBook, normalizeKalshiBook, quotes } = require('../js/books.js');

test('polymarket book: strings parse, sides sort best-first', () => {
  const raw = {
    bids: [{ price: '0.50', size: '120' }, { price: '0.53', size: '80' }],
    asks: [{ price: '0.60', size: '40' }, { price: '0.57', size: '200' }],
  };
  const b = normalizePolymarketBook(raw, 1000);
  assert.equal(b.t, 1000);
  assert.deepEqual(b.bids.map(l => l.p), [0.53, 0.50]);     // best (highest) bid first
  assert.deepEqual(b.asks.map(l => l.p), [0.57, 0.60]);     // best (lowest) ask first
});

test('polymarket book: junk levels dropped, malformed payload → null', () => {
  const b = normalizePolymarketBook({ bids: [{ price: '0', size: '10' }, { price: '1.2', size: '5' },
    { price: '0.5', size: '0' }, { price: '0.4', size: '10' }], asks: [] }, 0);
  assert.equal(b.bids.length, 1);
  assert.equal(b.bids[0].p, 0.4);
  assert.equal(normalizePolymarketBook({}, 0), null);
  assert.equal(normalizePolymarketBook(null, 0), null);
});

test('kalshi book: NO bids become YES asks at the complement', () => {
  const raw = { orderbook: { yes: [[48, 100], [50, 60]], no: [[45, 80], [47, 30]] } };
  const b = normalizeKalshiBook(raw, 2000);
  assert.deepEqual(b.bids.map(l => l.p), [0.5, 0.48]);            // yes bids, best first
  assert.deepEqual(b.asks.map(l => [l.p, l.s]), [[0.53, 30], [0.55, 80]]);  // 1 − no bids, best first
});

test('quotes: derived top-of-book on both sides', () => {
  const q = quotes({ t: 0, bids: [{ p: 0.5, s: 100 }], asks: [{ p: 0.55, s: 40 }] });
  assert.equal(q.yesBid, 0.5);
  assert.equal(q.yesAsk, 0.55);
  assert.equal(q.noBid, 0.45);      // selling NO = complement of buying YES
  assert.equal(q.noAsk, 0.5);       // buying NO consumes YES bids
  assert.equal(q.noAskSize, 100);
  assert.equal(q.mid, 0.525);
  assert.equal(quotes(null), null);
});

test('quotes: one-sided book leaves the missing side null', () => {
  const q = quotes({ t: 0, bids: [], asks: [{ p: 0.6, s: 10 }] });
  assert.equal(q.yesBid, null);
  assert.equal(q.noAsk, null);
  assert.equal(q.yesAsk, 0.6);
});
