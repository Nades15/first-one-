/* Full-pipeline replay test — node --test livebot/test/replay.test.js.
 * Drives the committed session fixture through feed→sniper→positions→
 * paperBroker→risk→store and asserts (a) a real trade completes and (b) two
 * runs produce byte-identical trade logs. This is the determinism guarantee
 * the whole "tune offline via replay" workflow rests on. Zero network. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { CONFIG } = require('../js/config.js');
const { createStore } = require('../js/store.js');
const { createRisk } = require('../js/risk.js');
const { createPaperBroker } = require('../js/paperBroker.js');
const { createPipeline } = require('../js/pipeline.js');
const { createReplaySource } = require('../js/feed.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'session.jsonl');

function runOnce() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livebot-replay-'));
  const store = createStore({ dir });
  const risk = createRisk({ cfg: CONFIG, store, live: false, now: () => 0 });
  const broker = createPaperBroker(CONFIG);
  let seq = 0;
  const pipe = createPipeline({
    cfg: CONFIG, store, risk, broker, selfWallet: 'you',
    uid: () => 'r' + (++seq), now: () => 0, log: () => {},
  });
  const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  createReplaySource(lines, {
    tickMs: CONFIG.FEED.tickMs,
    onMessage: (raw, recvT) => pipe.onMessage(raw, recvT),
    onTick: (t) => pipe.onTick(t),
  }).run();
  const trades = store.allTrades();
  const raw = fs.readFileSync(store.files.trades, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { trades, raw };
}

test('the fixture produces exactly one completed, entered trade', () => {
  const { trades } = runOnce();
  assert.equal(trades.length, 1);
  const t = trades[0];
  assert.ok(t.entry, 'has an entry fill');
  assert.equal(t.mode, 'paper');
  assert.equal(t.symbol, 'ZETA');
  assert.equal(t.exit.reason, 'EMERGENCY_WHALE_DUMP');   // dev rug is caught
  assert.equal(typeof t.pnlNetSol, 'number');
  assert.ok(t.entry.fees.priority > 0, 'priority fee is charged');   // regression guard
});

test('two replays of the same session are byte-identical', () => {
  const a = runOnce();
  const b = runOnce();
  assert.equal(a.raw, b.raw);                            // deterministic trade log
  assert.deepEqual(a.trades, b.trades);
});

test('entry cost and PnL accounting are self-consistent', () => {
  const { trades } = runOnce();
  const t = trades[0];
  // pnl = net proceeds - total wallet debit at entry
  assert.ok(Math.abs(t.pnlNetSol - (t.exit.solOutNet - t.entry.solSpent)) < 1e-9);
  assert.ok(t.entry.solSpent > 0.05);                    // 0.05 buy + priority + network
});
