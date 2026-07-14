/* Store — node --test fairline/test/store.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { tempStore } = require('./helpers.js');

test('trades append, read back, and feed the gate stats', () => {
  const store = tempStore();
  store.appendTrade({ mode: 'paper', pnlNetUsd: 1.5, entryFair: 0.7, won: true });
  store.appendTrade({ mode: 'paper', pnlNetUsd: -0.5, entryFair: 0.65, won: false });
  store.appendTrade({ mode: 'other', pnlNetUsd: 100 });          // not paper — excluded
  assert.equal(store.allTrades().length, 3);
  assert.deepEqual(store.gateStats(), { paperTrades: 2, paperNetUsd: 1 });
});

test('ledger round-trips atomically', () => {
  const store = tempStore();
  assert.equal(store.readLedger(), null);
  store.writeLedger({ dateUtc: '2026-07-14', realizedNetUsd: -3, trades: 7, halted: false });
  assert.equal(store.readLedger().trades, 7);
});

test('calibration buckets settled trades by entry probability', () => {
  const store = tempStore();
  // 0.6-bucket: predicted ~0.65, hits 2 of 3. Early exits (won:null) excluded.
  store.appendTrade({ mode: 'paper', entryFair: 0.62, won: true, pnlNetUsd: 1 });
  store.appendTrade({ mode: 'paper', entryFair: 0.65, won: true, pnlNetUsd: 1 });
  store.appendTrade({ mode: 'paper', entryFair: 0.68, won: false, pnlNetUsd: -1 });
  store.appendTrade({ mode: 'paper', entryFair: 0.66, won: null, pnlNetUsd: 0.2 });
  store.appendTrade({ mode: 'paper', entryFair: 0.31, won: true, pnlNetUsd: 1 });
  const cal = store.calibration(0.1);
  assert.equal(cal.length, 2);
  assert.deepEqual(cal[0], { lo: 0.3, n: 1, predicted: 0.31, actual: 1 });
  assert.equal(cal[1].n, 3);
  assert.ok(Math.abs(cal[1].predicted - 0.65) < 1e-4);
  assert.ok(Math.abs(cal[1].actual - 2 / 3) < 1e-4);   // stored rounded to 4dp
});

test('session filenames are sanitized into the sessions dir', () => {
  const path = require('path');
  const store = tempStore();
  const file = store.sessionPath('2026-07-14T12:00:00Z weird/../name.jsonl');
  // separators are stripped, so the file cannot escape data/sessions/
  assert.equal(path.dirname(file), path.join(store.dir, 'sessions'));
  store.appendLine(file, { recvT: 1, kind: 'spot', asset: 'BTC', price: 118000 });
  assert.equal(store.readLines(file).length, 1);
});
