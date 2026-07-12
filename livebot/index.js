#!/usr/bin/env node
/* Livebot — entrypoint. Wires a message source (live PumpPortal ws, or a
 * recorded session replay) to the pipeline, drives ticks on a clock, and runs
 * the dashboard. Paper mode is the default and needs no wallet; live mode is
 * gated behind the stats gate, the .env safety check, and a typed
 * confirmation.
 *
 *   node livebot                 paper mode against the live feed (default)
 *   node livebot --replay FILE   replay a recorded session offline
 *   node livebot --record-only   just record the feed, no trading
 *   node livebot --live          arm real trading (only if the gate is open)
 */
'use strict';

const path = require('path');
const readline = require('readline');

const env = require('./js/env.js');
const { CONFIG, withOverrides } = require('./js/config.js');
const { createStore } = require('./js/store.js');
const { createRisk } = require('./js/risk.js');
const { createPaperBroker } = require('./js/paperBroker.js');
const { createPipeline } = require('./js/pipeline.js');
const feed = require('./js/feed.js');

function parseArgs(argv) {
  const a = { live: false, replay: null, recordOnly: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--live') a.live = true;
    else if (argv[i] === '--replay') a.replay = argv[++i];
    else if (argv[i] === '--record-only') a.recordOnly = true;
  }
  return a;
}

function loadConfig(store) {
  return withOverrides(CONFIG, store.readSettings());
}

/* ------------------------------- replay -------------------------------- */

function runReplay(file, realStore, cfg) {
  const fs = require('fs');
  const os = require('os');
  // Replays use a THROWAWAY store so they never append to the real trade log —
  // otherwise you could farm the go-live gate by replaying a winning session.
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'livebot-replay-')) });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const risk = createRisk({ cfg, store, live: false, now: () => 0 });
  const broker = createPaperBroker(cfg);
  let seq = 0;
  const pipe = createPipeline({
    cfg, store, risk, broker, selfWallet: 'you',
    uid: () => 'r' + (++seq), now: () => 0,
    log: () => {},
  });
  const before = store.allTrades().length;
  const rp = feed.createReplaySource(lines, {
    tickMs: cfg.FEED.tickMs,
    onMessage: (raw, recvT) => pipe.onMessage(raw, recvT),
    onTick: (t) => pipe.onTick(t),
  });
  rp.run();
  const trades = store.allTrades().slice(before);
  console.log('Replay complete: ' + rp.count + ' messages → ' + trades.length + ' trade(s).');
  for (const t of trades) {
    console.log('  ' + (t.symbol || t.mint) + '  ' + t.exit.reason + '  pnl ' +
      t.pnlNetSol.toFixed(5) + ' SOL (' + t.pnlPct + '%)' + (t.exit.failed ? ' [failed]' : ''));
  }
  return trades;
}

/* ----------------------------- live/paper ------------------------------ */

async function armLive(cfg, store, envVars) {
  const wallet = require('./js/wallet.js');
  const gate = createRisk({ cfg, store, live: false }).gateStatus();
  if (!gate.unlocked) {
    console.error('\n✋ Live mode is LOCKED by the stats gate.');
    console.error('   Need ≥' + gate.required + ' paper trades AND net-positive PnL.');
    console.error('   You have ' + gate.paperTrades + ' paper trades, net ' + gate.paperNetSol + ' SOL.');
    console.error('   Keep running paper mode (node livebot) until the gate opens.\n');
    process.exit(1);
  }
  const safe = wallet.assertSafe();
  if (!safe.safe) {
    console.error('\n✋ Refusing to arm live — your key file is not safe:');
    for (const r of safe.reasons) console.error('   - ' + r);
    process.exit(1);
  }
  env.validate(envVars, { requireWallet: true });
  const signer = wallet.load(envVars.WALLET_SECRET_KEY);
  console.log('\n⚠️  LIVE MODE — this spends REAL SOL from ' + signer.pubkey);
  console.log('   Caps: ' + cfg.RISK.perTradeCapSol + ' SOL/trade, ' + cfg.RISK.maxConcurrent +
    ' concurrent, ' + cfg.RISK.dailyStopSol + ' SOL daily stop.');
  const ok = await confirm('Type exactly "ARM LIVE" to proceed: ', 'ARM LIVE');
  if (!ok) { console.log('Not confirmed — staying in paper mode is safer. Exiting.'); process.exit(0); }
  return signer;
}

function confirm(prompt, expected) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, ans => { rl.close(); resolve(ans.trim() === expected); });
  });
}

async function runLive(args, store, cfg, envVars) {
  const startMs = Date.now();
  const nowRel = () => Date.now() - startMs;

  let signer = null, broker, live = args.live;
  if (live) {
    signer = await armLive(cfg, store, envVars);
    const { createLiveBroker } = require('./js/liveBroker.js');
    broker = createLiveBroker(cfg, { rpcUrl: envVars.HELIUS_RPC_URL, signer });
  } else {
    broker = createPaperBroker(cfg);
    console.log('Paper mode (no real trades). Dashboard: http://' + cfg.SERVER.host + ':' + cfg.SERVER.port);
  }

  const risk = createRisk({
    cfg, store, live,
    getBalance: signer ? async () => broker.getBalanceSol() : null,
  });

  const session = new Date(startMs).toISOString().replace(/[:.]/g, '-');
  const recorder = feed.createRecorder(store, session);

  const pipe = createPipeline({
    cfg, store, risk, broker, selfWallet: signer ? signer.pubkey : 'you',
    blacklist: mapTrue(store.readBlacklist()),
    uid: store.uid || (() => Math.random().toString(36).slice(2, 9)),
    now: () => Date.now(),
    log: (t, kind, mint, msg) => { if (kind === 'emergency' || kind === 'abort') console.log('[' + (t / 1000).toFixed(1) + 's] ' + kind + ' ' + (mint || '') + ' ' + msg); },
    subscribe: (mint) => src.subscribeToken(mint),
    unsubscribe: (mint) => src.unsubscribeToken(mint),
  });

  const src = feed.createWsSource({
    url: cfg.FEED.wsUrl,
    reconnectMinMs: cfg.FEED.reconnectMinMs, reconnectMaxMs: cfg.FEED.reconnectMaxMs,
    onMessage: (raw) => {
      const t = nowRel();
      recorder.record(raw, t);
      if (!args.recordOnly) pipe.onMessage(raw, t);
    },
    onStatus: (s) => { if (!s.connected) console.log('feed disconnected — reconnecting…'); },
  });
  src.start();
  src.subscribeNewToken();

  // holder poller (open positions only), throttled
  const holderPoller = feed.createHolderPoller({
    intervalMs: cfg.FEED.holderPollMs, supply: cfg.FEED.supply,
    rpcCall: live ? (req) => broker.rpc(req.method, req.params) : null,
  });

  // tick + housekeeping loop
  let feedLostSince = null;
  const ticker = setInterval(async () => {
    const t = nowRel();
    if (!args.recordOnly) pipe.onTick(t);

    // holder corrector for open positions
    if (cfg.FEED.holderPollEnabled && live) {
      for (const p of pipe.positions.all()) {
        const rows = await holderPoller.poll(p.mint);
        if (rows) pipe.setHolders(p.mint, rows);
      }
    }

    // feed-loss handling: sell out if the socket goes quiet while holding
    const ago = src.lastMsgAgoMs();
    if (ago > cfg.FEED.staleMsgMs && pipe.positions.count() > 0) {
      if (feedLostSince == null) feedLostSince = t;
      if (t - feedLostSince > cfg.FEED.disconnectGraceMs) { pipe.onFeedLost(t); feedLostSince = null; }
    } else { feedLostSince = null; }
  }, cfg.FEED.tickMs);

  const { startServer } = require('./js/server.js');
  const server = startServer({
    cfg, store, risk,
    getState: () => buildState(pipe, risk, store, src, signer, broker),
    onPanic: () => { pipe.panicExit(nowRel()); risk.panic(); },
  });

  // Ctrl-C: first = panic-sell then exit; second = hard exit.
  let sigints = 0;
  process.on('SIGINT', () => {
    if (++sigints >= 2) process.exit(1);
    console.log('\nPanic: selling all open positions, then exiting…');
    pipe.panicExit(nowRel()); risk.panic();
    setTimeout(() => { clearInterval(ticker); src.close(); server.close(); process.exit(0); }, 1500);
  });
}

function buildState(pipe, risk, store, src, signer, broker) {
  const snap = pipe.snapshot();
  const gate = risk.gateStatus();
  return {
    mode: risk.mode(),
    feed: { connected: src.connected(), lastMsgAgoMs: Math.round(src.lastMsgAgoMs()),
      watched: snap.watched.length, unknownMsgs: snap.stats.unknownMsgs, launches: snap.stats.launches },
    gate,
    ledger: risk.ledgerState(),
    positions: snap.positions,
    recentTrades: store.recentTrades(50).reverse(),
    wallet: { pubkey: signer ? signer.pubkey : null, balanceSol: broker.cachedBalanceSol ? broker.cachedBalanceSol() : null },
  };
}

function mapTrue(obj) { const m = {}; for (const k of Object.keys(obj || {})) m[k] = true; return m; }

/* --------------------------------- main -------------------------------- */

async function main() {
  const args = parseArgs(process.argv);
  const store = createStore({});
  const cfg = loadConfig(store);

  if (args.replay) { runReplay(args.replay, store, cfg); return; }

  const envVars = env.load(path.join(__dirname));
  if (!args.recordOnly) {
    try { env.validate(envVars, { requireWallet: args.live }); }
    catch (e) {
      if (args.live) { console.error(e.message); process.exit(1); }
      console.log('Note: ' + e.message.split('\n')[0] + ' (paper mode continues; live needs it.)');
    }
  }
  await runLive(args, store, cfg, envVars);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { parseArgs, runReplay, loadConfig };
