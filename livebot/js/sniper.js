/* Livebot — entry filter. Decides which fresh pump.fun launches are worth
 * sniping. Pure and event-driven (no timers of its own; evaluation is driven
 * by trade/tick events carrying their own `t`), so it replays deterministically.
 *
 * The filters are UNPROVEN — nobody knows which thresholds actually predict a
 * profitable launch. That is what paper mode + skip-shadowing are for: skipped
 * candidates are still watched for a while and their outcome recorded, turning
 * every run into a labeled dataset for tuning cfg.SNIPER. */
'use strict';

function createSniper(opts) {
  const cfg = opts.cfg.SNIPER;
  const isBlacklisted = opts.isBlacklisted || (() => false);
  const canEnter = opts.canEnter || (() => ({ ok: true }));
  const onEnter = opts.onEnter || (() => {});
  const onSkip = opts.onSkip || (() => {});
  const maxWatched = opts.cfg.FEED.maxWatchedTokens;
  const supply = opts.cfg.FEED.supply;

  const candidates = new Map();             // mint -> candidate state

  function newCandidate(m) {
    return {
      mint: m.mint, creator: m.creator, name: m.name, symbol: m.symbol, uri: m.uri,
      launchT: m.recvT, devBuySol: m.devBuySol, devTokens: m.devBuyTokens,
      buyers: new Set(), sellers: new Set(),
      netInflowSol: 0, grossBuySol: 0, trades: 0,
      curveSol: m.vSol, decided: false, entered: false,
      peakPrice: m.vSol / m.vTokens, entryPrice: m.vSol / m.vTokens, rugged: false,
    };
  }

  /* Cheap gates applied at launch, before we even watch the flow. */
  function launchGate(m) {
    if (isBlacklisted(m.creator)) return 'CREATOR_BLACKLISTED';
    if (m.devBuySol < cfg.devBuyMinSol) return 'DEV_BUY_TOO_SMALL(' + m.devBuySol + ')';
    if (m.devBuySol > cfg.devBuyMaxSol) return 'DEV_BUY_TOO_LARGE(' + m.devBuySol + ')';
    if (cfg.requireName && (!m.name || !m.symbol)) return 'NO_NAME';
    return null;
  }

  function onLaunch(m) {
    const gate = launchGate(m);
    if (gate) { onSkip({ mint: m.mint, t: m.recvT, reasons: [gate], watched: false }); return false; }
    if (candidates.size >= maxWatched) {
      // evict the oldest still-undecided candidate to make room
      let oldest = null;
      for (const c of candidates.values()) if (!c.entered && (!oldest || c.launchT < oldest.launchT)) oldest = c;
      if (oldest) candidates.delete(oldest.mint);
      else { onSkip({ mint: m.mint, t: m.recvT, reasons: ['WATCHLIST_FULL'], watched: false }); return false; }
    }
    candidates.set(m.mint, newCandidate(m));
    return true;                              // caller subscribes to this token's trades
  }

  function onTrade(m) {
    const c = candidates.get(m.mint);
    if (!c) return;
    c.trades++;
    const price = m.vTokens > 0 ? m.vSol / m.vTokens : c.peakPrice;
    if (price > c.peakPrice) c.peakPrice = price;
    c.curveSol = m.vSol;
    if (m.wallet === c.creator) return;       // dev's own flow doesn't count as demand
    if (m.side === 'buy') { c.buyers.add(m.wallet); c.netInflowSol += m.sol; c.grossBuySol += m.sol; }
    else { c.sellers.add(m.wallet); c.netInflowSol -= m.sol; if (price < c.entryPrice * 0.5) c.rugged = true; }
  }

  function devPct(c, holders) {
    if (holders) { for (const h of holders) if (h.wallet === c.creator) return h.pct; }
    return c.devTokens / supply * 100;        // fall back to the launch buy
  }

  /* Called each tick for watched mints. Returns nothing; fires onEnter/onSkip. */
  function evaluate(mint, nowT, holders, openCount) {
    const c = candidates.get(mint);
    if (!c || c.decided) return;

    // shadow bookkeeping for skipped candidates (tuning dataset)
    if (c.entered) return;

    const age = nowT - c.launchT;
    if (age < cfg.decideAfterMs) return;      // give the flow time to develop

    const fails = [];
    const dev = devPct(c, holders);
    if (c.buyers.size < cfg.minUniqueBuyers) fails.push('FEW_BUYERS(' + c.buyers.size + ')');
    if (c.netInflowSol < cfg.minNetInflowSol) fails.push('LOW_INFLOW(' + round(c.netInflowSol, 2) + ')');
    if (dev > cfg.maxDevHoldPct) fails.push('DEV_HOLDS(' + round(dev, 1) + '%)');
    if (c.curveSol < cfg.minCurveSol) fails.push('CURVE_TOO_EARLY(' + round(c.curveSol, 1) + ')');
    if (c.curveSol > cfg.maxCurveSol) fails.push('CURVE_TOO_HOT(' + round(c.curveSol, 1) + ')');

    if (!fails.length) {
      const rc = canEnter(openCount);
      if (!rc.ok) fails.push('RISK_' + rc.reason);
    }

    if (!fails.length) {
      c.decided = true; c.entered = true;
      const reasons = [
        'BUYERS_OK(' + c.buyers.size + ')', 'INFLOW_OK(' + round(c.netInflowSol, 2) + ')',
        'DEV_OK(' + round(dev, 1) + '%)', 'CURVE_OK(' + round(c.curveSol, 1) + ')',
      ];
      onEnter({ mint, t: nowT, name: c.name, symbol: c.symbol, creator: c.creator, reasons });
      return;
    }

    if (age >= cfg.giveUpMs) {
      c.decided = true;
      onSkip({ mint, t: nowT, reasons: fails, watched: true, candidate: c });
      // keep it in the map for shadow tracking until shadowMs elapses
    }
  }

  /* After a skip, keep watching to learn whether we were right. Called on tick;
   * returns a finished shadow record (or null) once shadowMs elapses. */
  function shadowTick(mint, nowT) {
    const c = candidates.get(mint);
    if (!c || !c.decided || c.entered) return null;
    if (nowT - c.launchT < cfg.shadowMs) return null;
    candidates.delete(mint);
    const peakGainPct = c.entryPrice > 0 ? (c.peakPrice - c.entryPrice) / c.entryPrice * 100 : 0;
    return {
      mint, creator: c.creator, symbol: c.symbol, launchT: c.launchT,
      peakGainPct: round(peakGainPct, 1), rugged: c.rugged,
      buyers: c.buyers.size, netInflowSol: round(c.netInflowSol, 3),
    };
  }

  function forget(mint) { candidates.delete(mint); }
  function has(mint) { return candidates.has(mint); }
  function watchedMints() { return Array.from(candidates.keys()); }

  return { onLaunch, onTrade, evaluate, shadowTick, forget, has, watchedMints };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createSniper };
