/* Livebot — orchestrator. Wires the feed's per-mint TickBuilders to the
 * sniper and the position manager. Message- and tick-driven with no timers of
 * its own, so the SAME pipeline runs live (driven by the ws source + a wall
 * clock) and in replay (driven by recorded messages + a virtual clock),
 * deterministically. index.js supplies the source and the broker; this file
 * contains the routing logic that the replay test exercises end to end. */
'use strict';

const { normalizeMsg, createTickBuilder } = require('./feed.js');
const { createSniper } = require('./sniper.js');
const { createPositionManager } = require('./positions.js');

function createPipeline(opts) {
  const cfg = opts.cfg;
  const store = opts.store;
  const risk = opts.risk;
  const log = opts.log || (() => {});
  const subscribe = opts.subscribe || (() => {});      // (mint) => tell feed to stream this token
  const unsubscribe = opts.unsubscribe || (() => {});
  const selfWallet = opts.selfWallet || 'you';
  const blacklist = opts.blacklist || {};

  const builders = new Map();          // mint -> TickBuilder (watched or held)
  const lastTick = new Map();          // mint -> latest tick (for entry timing)
  const graduating = new Set();        // mints flagged for graduation exit
  const stats = { unknownMsgs: 0, launches: 0, entries: 0, skips: 0 };

  const sniper = createSniper({
    cfg,
    isBlacklisted: (creator) => !!blacklist[creator],
    canEnter: (openCount) => risk.canEnter(openCount),
    onEnter: (e) => {
      stats.entries++;
      const tick = lastTick.get(e.mint);
      if (tick) positions.open(e.mint, e, tick);
    },
    onSkip: (s) => {
      stats.skips++;
      if (s.watched && s.candidate) { /* keep watching for the shadow window */ }
    },
  });

  const positions = createPositionManager({
    cfg, broker: opts.broker, risk, store, selfWallet, log,
    uid: opts.uid, now: opts.now,
    onClose: (pos, rec) => {
      // auto-blacklist a creator whose position we exited on a dev-driven dump
      if (rec && rec.exit && rec.exit.reason === 'EMERGENCY_WHALE_DUMP' && rec.creator) {
        store.addBlacklist(rec.creator, 'whale/dev dump exit', rec.mint);
        blacklist[rec.creator] = true;
      }
      cleanup(pos.mint);
    },
  });

  function ensureBuilder(mint, launchMsg) {
    if (builders.has(mint)) return builders.get(mint);
    const tb = createTickBuilder({
      supply: cfg.FEED.supply, selfWallet,
      devWallet: launchMsg ? launchMsg.creator : undefined,
    });
    if (launchMsg) tb.note(launchMsg);
    builders.set(mint, tb);
    subscribe(mint);
    return tb;
  }

  function cleanup(mint) {
    if (positions.has(mint) || sniper.has(mint)) return;   // still needed
    builders.delete(mint);
    lastTick.delete(mint);
    graduating.delete(mint);
    unsubscribe(mint);
  }

  /* Feed every raw ws (or recorded) message here. */
  function onMessage(raw, recvT) {
    const m = normalizeMsg(raw, recvT);
    if (m.kind === 'unknown') { stats.unknownMsgs++; return; }

    if (m.kind === 'launch') {
      stats.launches++;
      if (sniper.onLaunch(m)) ensureBuilder(m.mint, m);
      return;
    }
    if (m.kind === 'migration') {
      if (positions.has(m.mint)) graduating.add(m.mint);
      return;
    }
    if (m.kind === 'trade') {
      const tb = builders.get(m.mint);
      if (!tb) return;                 // not a token we're tracking
      tb.note(m);
      if (sniper.has(m.mint)) sniper.onTrade(m);
    }
  }

  /* Advance every tracked mint one tick at time t. */
  function onTick(t) {
    for (const mint of Array.from(builders.keys())) {
      const tb = builders.get(mint);
      if (!tb) continue;
      const tick = tb.flush(t);
      lastTick.set(mint, tick);

      // graduation while holding → immediate exit
      if (graduating.has(mint) && positions.has(mint) && cfg.TRADE.sellOnGraduation) {
        positions.forceExit(mint, tick, 'GRADUATION');
      }

      positions.onTick(mint, tick);

      // still a candidate (not yet a position): let the sniper judge / shadow it
      if (!positions.has(mint) && sniper.has(mint)) {
        sniper.evaluate(mint, t, tick.holders, positions.count());
        const shadow = sniper.shadowTick(mint, t);
        if (shadow) { store.appendSkip(shadow); cleanup(mint); }
      }
    }
  }

  /* Feed lost while holding → best-effort exit everything. */
  function onFeedLost(t) {
    for (const pos of positions.all()) {
      const tick = lastTick.get(pos.mint) || { t, pool: null, holders: [], trades: [], flags: {} };
      positions.forceExit(pos.mint, Object.assign({}, tick, { t }), 'FEED_LOST');
    }
  }

  function panicExit(t) {
    for (const pos of positions.all()) {
      const tick = lastTick.get(pos.mint) || { t, pool: null, holders: [], trades: [], flags: {} };
      positions.forceExit(pos.mint, Object.assign({}, tick, { t }), 'PANIC');
    }
  }

  function setHolders(mint, rows) { const tb = builders.get(mint); if (tb) tb.setHolders(rows); }
  function setFlag(mint, name, value) { const tb = builders.get(mint); if (tb) tb.setFlag(name, value); }

  function snapshot() {
    return {
      stats: Object.assign({}, stats),
      watched: sniper.watchedMints(),
      positions: positions.all().map(p => ({
        mint: p.mint, symbol: p.meta.symbol, state: p.state,
        heldMs: p.entry && lastTick.get(p.mint) ? lastTick.get(p.mint).t - p.entry.t : 0,
        gauges: p.engine.snapshot(),
      })),
    };
  }

  return { onMessage, onTick, onFeedLost, panicExit, setHolders, setFlag, snapshot,
    positions, sniper, mintsTracked: () => Array.from(builders.keys()) };
}

module.exports = { createPipeline };
