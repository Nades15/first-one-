#!/usr/bin/env node
/* Fairline — entrypoint. Wires the input sources (live spot ws + market/book
 * pollers, an offline mock world, or a recorded session) to the pipeline,
 * drives ticks on a clock, and runs the dashboard. Paper trading only —
 * there is no live mode to arm.
 *
 *   node fairline                 paper-trade the live markets (default)
 *   node fairline --mock          offline synthetic world, no network
 *   node fairline --replay FILE   replay a recorded session deterministically
 *   node fairline --record-only   just record the feeds, no trading
 */
'use strict';

const path = require('path');

const { CONFIG, withOverrides } = require('./js/config.js');
const { createStore } = require('./js/store.js');
const { createRisk } = require('./js/risk.js');
const { createPaperBroker } = require('./js/paperBroker.js');
const { createPipeline } = require('./js/pipeline.js');
const { createSpotSource } = require('./js/spot.js');
const { createDiscovery } = require('./js/markets.js');
const { createBookPoller } = require('./js/books.js');
const { createRecorder, createReplaySource } = require('./js/replay.js');

function parseArgs(argv) {
  const a = { mock: false, replay: null, recordOnly: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--mock') a.mock = true;
    else if (argv[i] === '--replay') a.replay = argv[++i];
    else if (argv[i] === '--record-only') a.recordOnly = true;
  }
  return a;
}

function loadConfig(store) {
  return withOverrides(CONFIG, store.readSettings());
}

/* ------------------------------- replay --------------------------------- */

function runReplay(file, cfg) {
  const fs = require('fs');
  const os = require('os');
  // Throwaway store: replays must never append to the real trade log, or the
  // gate could be farmed by replaying one winning session on a loop.
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'fairline-replay-')) });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const risk = createRisk({ cfg, store, now: () => 0 });
  const broker = createPaperBroker(cfg);
  const pipe = createPipeline({ cfg, store, risk, broker, log: () => {} });

  const rp = createReplaySource(lines, { tickMs: cfg.ENGINE.tickMs, pipe });
  rp.run();

  const trades = store.allTrades();
  console.log('Replay complete: ' + rp.count + ' events → ' + trades.length + ' trade(s).');
  for (const t of trades) {
    console.log('  ' + t.key + '  ' + t.side + ' ×' + t.contracts + ' @' + t.avgPrice +
      '  ' + t.exitReason + (t.won == null ? '' : t.won ? ' WON' : ' LOST') +
      '  pnl ' + t.pnlNetUsd.toFixed(2) + ' USD');
  }
  const g = store.gateStats();
  console.log('Net: ' + g.paperNetUsd.toFixed(2) + ' USD over ' + g.paperTrades + ' settled trades.');
  return trades;
}

/* ------------------------------ live/mock ------------------------------- */

function run(args, store, cfg) {
  const risk = createRisk({ cfg, store });
  const broker = createPaperBroker(cfg);

  const session = new Date().toISOString().replace(/[:.]/g, '-') + (args.mock ? '-mock' : '');
  const recorder = createRecorder(store, session);
  const trading = !args.recordOnly;

  const pipe = createPipeline({
    cfg, store, risk, broker,
    log: (t, kind, msg) => {
      if (kind === 'entry' || kind === 'exit' || kind === 'settle') {
        console.log('[' + new Date(t).toISOString().slice(11, 19) + '] ' + kind + ' ' + msg);
      }
    },
  });

  let feedInfo = { connected: false, venue: null, kind: args.mock ? 'mock' : 'live' };

  if (args.mock) {
    const { createMockSource } = require('./js/mock.js');
    const src = createMockSource({ cfg, pipe, seed: 42 });
    src.start();
    feedInfo.connected = true; feedInfo.venue = 'mock';
    console.log('Mock mode: synthetic markets with planted mispricings — plumbing demo, not edge.');
  } else {
    const spotSrc = createSpotSource({
      cfg: cfg.SPOT,
      onPrice: (asset, price, recvT) => {
        recorder.spot(asset, price, recvT);
        if (trading) pipe.onSpot(asset, price, recvT);
      },
      onStatus: s => {
        feedInfo.connected = !!s.connected; feedInfo.venue = s.venue;
        if (s.rotated) { console.log('spot feed rotated to ' + s.venue); pipe.resetVol(); }
      },
    });
    spotSrc.start();

    const poller = createBookPoller({
      cfg: Object.assign({}, cfg.BOOKS, cfg.DISCOVERY),
      onBook: (key, book) => {
        recorder.book(key, book, Date.now());
        if (trading) pipe.onBook(key, book);
      },
      onError: () => pipe.onBookError(),
    });

    const discovery = createDiscovery({
      cfg: cfg.DISCOVERY,
      assets: Object.keys(cfg.SPOT.assets),
      onMarkets: (list, t) => {
        recorder.markets(list, t);
        if (trading) pipe.onMarkets(list, t);
        // Poll books for everything the pipeline still cares about (open
        // positions pin their market past the sweep), or the raw sweep when
        // record-only.
        poller.setMarkets(trading ? pipe.watchlist() : list);
      },
      onError: (platform, e) => { pipe.onDiscoveryError(); console.error('discovery ' + platform + ': ' + e.message); },
    });
    discovery.start();
    poller.start();
    console.log((trading ? 'Paper mode' : 'Record-only mode') +
      ' against live Polymarket/Kalshi data. Session: ' + recorder.file);
  }

  const ticker = setInterval(() => { if (trading) pipe.onTick(Date.now()); }, cfg.ENGINE.tickMs);

  const { startServer } = require('./js/server.js');
  const server = startServer({
    cfg,
    getState: () => buildState(pipe, risk, store, feedInfo),
    onPanic: () => { console.log('PANIC — closing all paper positions and halting.'); pipe.panicExit(Date.now()); },
  });

  // Ctrl-C: first press panic-closes and exits shortly; second exits now.
  let sigints = 0;
  process.on('SIGINT', () => {
    if (++sigints >= 2) process.exit(1);
    console.log('\nClosing paper positions, then exiting…');
    pipe.panicExit(Date.now());
    setTimeout(() => { clearInterval(ticker); server.close(); process.exit(0); },
      cfg.TRADE.paperLatencyMs + 2 * cfg.ENGINE.tickMs);
  });
}

function buildState(pipe, risk, store, feedInfo) {
  const snap = pipe.snapshot(Date.now());
  return {
    mode: risk.mode(),
    feed: feedInfo,
    gate: risk.gateStatus(),
    ledger: risk.ledgerState(),
    spot: snap.spot,
    markets: snap.markets,
    positions: snap.positions,
    stats: snap.stats,
    recentTrades: store.recentTrades(50).reverse(),
    calibration: store.calibration(0.1),
  };
}

/* --------------------------------- main --------------------------------- */

function main() {
  const args = parseArgs(process.argv);
  let store = createStore({});
  const cfg = loadConfig(store);
  if (args.replay) { runReplay(args.replay, cfg); return; }
  if (args.mock) {
    // Mock trades are wins against PLANTED mispricings — they must never
    // count toward the stats gate, so mock runs get a throwaway store.
    const fs = require('fs');
    const os = require('os');
    store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'fairline-mock-')) });
  }
  run(args, store, cfg);
}

if (require.main === module) main();

module.exports = { parseArgs, runReplay, loadConfig, buildState };
