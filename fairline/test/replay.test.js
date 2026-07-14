/* Replay determinism — node --test fairline/test/replay.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createReplaySource } = require('../js/replay.js');
const { createPipeline } = require('../js/pipeline.js');
const { createPaperBroker } = require('../js/paperBroker.js');
const { createRisk } = require('../js/risk.js');
const { testCfg, tempStore, book, aboveMarket } = require('./helpers.js');

/* A recorded session, as the recorder would have written it: one market, a
 * warming spot stream, one mispriced book, resolution in the money. */
function sessionLines() {
  const m = aboveMarket({ closeTime: 60e3 });
  const lines = [{ recvT: 0, kind: 'markets', list: [m] }];
  for (let t = 0, i = 0; t <= 61e3; t += 1000, i++) {
    lines.push({ recvT: t, kind: 'spot', asset: 'BTC', price: 101 * Math.exp(0.001 * (i % 2 ? 1 : -1)) });
  }
  lines.push({ recvT: 10e3, kind: 'book', key: m.key, book: book(10e3, 0.50, 0.55, 100) });
  lines.push({ recvT: 30e3, kind: 'book', key: m.key, book: book(30e3, 0.51, 0.56, 100) });
  return lines.map(l => JSON.stringify(l));             // as read back from JSONL
}

function runOnce(lines) {
  const cfg = testCfg();
  const store = tempStore();
  const risk = createRisk({ cfg, store, now: () => 0 });
  const pipe = createPipeline({ cfg, store, risk, broker: createPaperBroker(cfg) });
  const rp = createReplaySource(lines, { tickMs: cfg.ENGINE.tickMs, pipe });
  rp.run();
  return { trades: store.allTrades(), count: rp.count };
}

test('the same session replays to the identical trade log, twice', () => {
  const lines = sessionLines();
  const a = runOnce(lines);
  const b = runOnce(lines);
  assert.ok(a.count > 60, 'events parsed');
  assert.ok(a.trades.length >= 1, 'replay produced at least one trade');
  assert.equal(a.trades[0].exitReason, 'SETTLED');
  assert.equal(a.trades[0].won, true);
  assert.deepEqual(a.trades, b.trades);                 // byte-for-byte determinism
});

test('shuffled input lines land in the same order (sorted by recvT)', () => {
  const lines = sessionLines();
  const shuffled = lines.slice().reverse();
  assert.deepEqual(runOnce(lines).trades, runOnce(shuffled).trades);
});

test('garbage lines are skipped, not fatal', () => {
  const lines = ['not json', '{"recvT":null}', ...sessionLines()];
  assert.ok(runOnce(lines).trades.length >= 1);
});
