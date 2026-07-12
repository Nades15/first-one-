/* Store tests — node --test livebot/test/store.test.js. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../js/store.js');

function tmp() { return createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'livebot-store-')) }); }

test('trades append and read back in order', () => {
  const s = tmp();
  s.appendTrade({ mode: 'paper', pnlNetSol: 0.01 });
  s.appendTrade({ mode: 'live', pnlNetSol: -0.02 });
  const all = s.allTrades();
  assert.equal(all.length, 2);
  assert.equal(all[0].mode, 'paper');
  assert.equal(all[1].mode, 'live');
});

test('gate stats count only paper trades and cache-invalidate on append', () => {
  const s = tmp();
  s.appendTrade({ mode: 'paper', pnlNetSol: 0.03 });
  assert.deepEqual(s.gateStats(), { paperTrades: 1, paperNetSol: 0.03 });
  s.appendTrade({ mode: 'live', pnlNetSol: 5 });          // live ignored
  s.appendTrade({ mode: 'paper', pnlNetSol: -0.01 });
  assert.deepEqual(s.gateStats(), { paperTrades: 2, paperNetSol: 0.02 });
});

test('ledger and blacklist round-trip atomically', () => {
  const s = tmp();
  s.writeLedger({ dateUtc: '2026-07-12', realizedNetSol: -0.05, trades: 3, halted: false });
  assert.equal(s.readLedger().realizedNetSol, -0.05);
  s.addBlacklist('CREATOR1', 'rug', 'MINT1');
  s.addBlacklist('CREATOR1', 'again', 'MINT2');           // idempotent
  const bl = s.readBlacklist();
  assert.equal(Object.keys(bl).length, 1);
  assert.equal(bl.CREATOR1.mint, 'MINT1');
});

test('recentTrades returns the tail', () => {
  const s = tmp();
  for (let i = 0; i < 10; i++) s.appendTrade({ mode: 'paper', pnlNetSol: i });
  const r = s.recentTrades(3);
  assert.deepEqual(r.map(t => t.pnlNetSol), [7, 8, 9]);
});
