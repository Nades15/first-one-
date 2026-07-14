/* Paper broker fills — node --test fairline/test/paperBroker.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createPaperBroker, walkLevels, kalshiFeeUsd } = require('../js/paperBroker.js');
const { testCfg } = require('./helpers.js');

const KEY = 'kalshi:X';

function broker(over) { return createPaperBroker(testCfg(over)); }

test('walkLevels averages across levels and fills partially', () => {
  const asks = [{ p: 0.55, s: 100 }, { p: 0.60, s: 50 }];
  const w = walkLevels(asks, 120, p => p);
  assert.equal(w.contracts, 120);
  // avgPrice is rounded to 4dp for the log; the money number (notionalUsd) is exact
  assert.ok(Math.abs(w.avgPrice - (100 * 0.55 + 20 * 0.60) / 120) < 1e-4);
  assert.equal(w.notionalUsd, 67);
  const partial = walkLevels(asks, 500, p => p);
  assert.equal(partial.contracts, 150);          // the book only had 150
});

test('kalshi fee rounds UP to the cent', () => {
  assert.equal(kalshiFeeUsd(0.07, 1, 0.5), 0.02);       // 0.0175 → 0.02
  assert.equal(kalshiFeeUsd(0.07, 100, 0.5), 1.75);
  assert.equal(kalshiFeeUsd(0.07, 10, 0.05), 0.04);     // 0.03325 → 0.04
});

test('fills wait out the latency and price against the LATEST book', () => {
  const b = broker();                                       // paperLatencyMs 1000
  b.onBook(KEY, { t: 0, bids: [{ p: 0.5, s: 100 }], asks: [{ p: 0.55, s: 100 }] });
  const id = b.request('buy', 'yes', KEY, 10, { platform: 'polymarket', t: 0 });
  assert.deepEqual(b.onTick(500), []);                      // too early
  b.onBook(KEY, { t: 900, bids: [{ p: 0.55, s: 100 }], asks: [{ p: 0.60, s: 100 }] });  // moved against us
  const fills = b.onTick(1000);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].orderId, id);
  assert.equal(fills[0].ok, true);
  assert.equal(fills[0].avgPrice, 0.60);                    // adverse move eaten, honestly
  assert.equal(b.pendingCount(), 0);
});

test('NO side: buying walks YES bids at the complement, selling walks asks', () => {
  const b = broker();
  b.onBook(KEY, { t: 0, bids: [{ p: 0.50, s: 30 }, { p: 0.45, s: 100 }],
    asks: [{ p: 0.58, s: 100 }] });
  b.request('buy', 'no', KEY, 50, { platform: 'kalshi', t: 0 });
  const [buy] = b.onTick(1000);
  // 30 @ (1−0.50) + 20 @ (1−0.45) ⇒ avg (30·0.50 + 20·0.55)/50 = 0.52
  assert.equal(buy.contracts, 50);
  assert.ok(Math.abs(buy.avgPrice - 0.52) < 1e-9);
  assert.equal(buy.feeUsd, kalshiFeeUsd(0.07, 50, buy.avgPrice));

  b.request('sell', 'no', KEY, 10, { platform: 'kalshi', t: 1000 });
  const [sell] = b.onTick(2000);
  assert.ok(Math.abs(sell.avgPrice - 0.42) < 1e-9);         // 1 − 0.58
});

test('polymarket fee is zero by default; missing/stale book fails the fill', () => {
  const b = broker();
  b.onBook(KEY, { t: 0, bids: [{ p: 0.5, s: 100 }], asks: [{ p: 0.55, s: 100 }] });
  b.request('buy', 'yes', KEY, 10, { platform: 'polymarket', t: 0 });
  assert.equal(b.onTick(1000)[0].feeUsd, 0);

  b.request('buy', 'yes', 'polymarket:missing', 10, { platform: 'polymarket', t: 1000 });
  const [noBook] = b.onTick(2000);
  assert.equal(noBook.ok, false);
  assert.equal(noBook.failReason, 'NO_BOOK');

  const stale = broker({ BOOKS: { staleMs: 500 } });
  stale.onBook(KEY, { t: 0, bids: [], asks: [{ p: 0.55, s: 100 }] });
  stale.request('buy', 'yes', KEY, 10, { platform: 'polymarket', t: 0 });
  assert.equal(stale.onTick(1000)[0].failReason, 'NO_BOOK');
});

test('cancelForMarket drops queued orders', () => {
  const b = broker();
  b.onBook(KEY, { t: 0, bids: [], asks: [{ p: 0.55, s: 100 }] });
  b.request('buy', 'yes', KEY, 10, { platform: 'kalshi', t: 0 });
  b.cancelForMarket(KEY);
  assert.deepEqual(b.onTick(5000), []);
});
