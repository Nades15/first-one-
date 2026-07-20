/* Fairline — the conductor. Feeds spot ticks into the vol estimators, keeps
 * the watchlist and its books, computes each market's fair probability, asks
 * the strategy for decisions, routes orders through the (paper) broker, and
 * settles positions at resolution against the spot close.
 *
 * Everything arrives through four inputs — onSpot / onMarkets / onBook /
 * onTick — so the live loop, the replay source, and the mock source drive
 * the identical code path. No wall clocks in here. */
'use strict';

const { probBetween, createVolEstimator } = require('./fair.js');
const { quotes } = require('./books.js');
const { evaluate, resolveYes } = require('./strategy.js');
const { createPositions } = require('./positions.js');

const UPDOWN_OPEN_GRACE_MS = 10000;   // capture the up/down open within this or skip the market
const FAIR_CLAMP = 0.005;             // never claim <0.5% or >99.5% — tails are model fiction

function createPipeline(opts) {
  const cfg = opts.cfg;
  const store = opts.store;
  const risk = opts.risk;
  const broker = opts.broker;
  const log = opts.log || (() => {});

  const positions = createPositions();
  const spot = new Map();               // asset -> { vol, price, lastT }
  const watched = new Map();            // key -> market (mutable: floor capture, flags)
  const books = new Map();              // key -> canonical book
  const lastFillT = new Map();          // key -> t of last fill (cooldown)
  const pendingEntry = new Map();       // key -> { orderId, decision }
  const pendingExit = new Map();        // key -> { orderId, reason }
  const stats = { spotMsgs: 0, sweeps: 0, bookUpdates: 0, entries: 0, exits: 0,
    settles: 0, fillFails: 0, discoveryErrors: 0, bookErrors: 0 };

  const dcfg = () => ({
    strategy: cfg.STRATEGY, books: cfg.BOOKS, fees: cfg.FEES,
    sizeUsd: Math.min(cfg.TRADE.sizeUsd, risk.perTradeUsd()),
  });

  function newEstimator() {
    return createVolEstimator({ sampleMs: cfg.SPOT.sampleMs,
      halfLifeMs: cfg.SPOT.volHalfLifeMs, minSamples: cfg.SPOT.minVolSamples });
  }

  function assetState(asset) {
    let s = spot.get(asset);
    if (!s) {
      s = { vol: newEstimator(), price: 0, lastT: 0 };
      spot.set(asset, s);
    }
    return s;
  }

  /* Cross-venue price jumps are not returns — drop vol history on rotation. */
  function resetVol() {
    for (const s of spot.values()) s.vol = newEstimator();
  }

  /* ------------------------------- inputs -------------------------------- */

  function onSpot(asset, price, t) {
    stats.spotMsgs++;
    const s = assetState(asset);
    s.vol.note(price, t);
    s.price = price;
    s.lastT = t;
  }

  function onMarkets(list, t) {
    stats.sweeps++;
    const keep = new Set(list.map(m => m.key));
    for (const m of list) {
      if (!watched.has(m.key)) watched.set(m.key, m);
    }
    // Markets that fell out of the sweep leave only once they carry nothing —
    // an open position or in-flight order pins its market until resolved.
    for (const key of watched.keys()) {
      if (keep.has(key) || positions.has(key) || pendingEntry.has(key) || pendingExit.has(key)) continue;
      watched.delete(key);
      books.delete(key);
    }
  }

  function onBook(key, book) {
    if (!watched.has(key)) return;
    stats.bookUpdates++;
    books.set(key, book);
    broker.onBook(key, book);
    positions.markToBook(key, quotes(book));
  }

  /* ------------------------------ fair value ------------------------------ */

  function fairFor(m, t) {
    if (m.unpriceable) return null;
    if (m.floor == null && m.cap == null) return null;          // up/down open not yet captured
    const s = spot.get(m.asset);
    if (!s || !(s.price > 0) || t - s.lastT > cfg.SPOT.staleMsgMs) return null;
    const sigma = s.vol.sigmaPerSqrtSec();
    if (sigma == null) return null;                             // estimator still warming up
    const tauSec = (m.closeTime - t) / 1000;
    const p = probBetween(s.price, m.floor, m.cap, sigma, tauSec);
    if (!isFinite(p)) return null;
    return Math.min(1 - FAIR_CLAMP, Math.max(FAIR_CLAMP, p));
  }

  /* -------------------------------- ticks -------------------------------- */

  function onTick(t) {
    // 1) housekeeping per market: up/down open capture, then settlement.
    for (const [key, m] of watched) {
      if (m.kind === 'updown' && m.floor == null && !m.unpriceable && t >= m.windowStart) {
        const s = spot.get(m.asset);
        if (s && s.price > 0 && t - m.windowStart <= UPDOWN_OPEN_GRACE_MS) {
          m.floor = s.price;
          log(t, 'open-capture', key + ' open=' + s.price);
        } else if (t - m.windowStart > UPDOWN_OPEN_GRACE_MS) {
          m.unpriceable = true;                 // missed the open — never price this window
        }
      }

      if (t >= m.closeTime) {
        broker.cancelForMarket(key);
        pendingEntry.delete(key);
        pendingExit.delete(key);
        if (positions.has(key)) {
          const s = spot.get(m.asset);
          const spotAtClose = s && s.price > 0 ? s.price : null;
          const wonYes = resolveYes(m, spotAtClose);
          if (wonYes != null) {
            const rec = positions.settle(key, wonYes, spotAtClose, t);
            store.appendTrade(rec);
            risk.settle(rec.pnlNetUsd);
            stats.settles++;
            log(t, 'settle', key + ' ' + rec.side + ' ' + (rec.won ? 'WON' : 'LOST') +
              ' pnl ' + rec.pnlNetUsd);
          } else {
            // No spot at close (feed died) — leave the position; retry while
            // the market stays watched.
            continue;
          }
        }
        watched.delete(key);
        books.delete(key);
        continue;
      }
    }

    // 2) decisions (skipped entirely when panicked — only exits below).
    const panicked = risk.isPanicked();
    for (const [key, m] of watched) {
      // Still here past close only while waiting for a spot price to settle
      // against — never trade a resolved market.
      if (t >= m.closeTime) { m._status = 'awaiting-settle'; continue; }
      const fair = fairFor(m, t);
      m._fair = fair;
      if (pendingEntry.has(key) || pendingExit.has(key)) { m._status = 'in-flight'; continue; }

      if (panicked) {
        const pos = positions.get(key);
        if (pos) {
          const orderId = broker.request('sell', pos.side, key, pos.contracts, { platform: m.platform, t });
          pendingExit.set(key, { orderId, reason: 'PANIC' });
        }
        m._status = 'panic';
        continue;
      }

      const sig = spot.get(m.asset);
      const d = evaluate({ market: m, book: books.get(key) || null, fair,
        sigma: sig ? sig.vol.sigmaPerSqrtSec() : null,
        position: positions.get(key), t, lastFillT: lastFillT.get(key) || 0, cfg: dcfg() });
      m._status = positions.has(key) ? 'open' : d.reason;
      m._decision = d;

      if (d.action === 'buy_yes' || d.action === 'buy_no') {
        const gate = risk.canEnter(positions.count() + pendingEntry.size);
        if (!gate.ok) { m._status = gate.reason; continue; }
        const orderId = broker.request('buy', d.side, key, d.contracts, { platform: m.platform, t });
        pendingEntry.set(key, { orderId, decision: d });
        log(t, 'entry-request', key + ' ' + d.side + ' ×' + d.contracts + ' @~' + d.price +
          ' edge ' + d.edge);
      } else if (d.action === 'exit') {
        const orderId = broker.request('sell', d.side, key, d.contracts, { platform: m.platform, t });
        pendingExit.set(key, { orderId, reason: d.reason });
        log(t, 'exit-request', key + ' ' + d.side + ' @~' + d.price);
      }
    }

    // 3) drain fills.
    for (const fill of broker.onTick(t)) {
      const key = fill.marketKey;
      const entry = pendingEntry.get(key);
      const exit = pendingExit.get(key);

      if (entry && entry.orderId === fill.orderId) {
        pendingEntry.delete(key);
        if (fill.ok && watched.has(key)) {
          positions.openFrom(fill, watched.get(key), entry.decision, t);
          lastFillT.set(key, t);
          stats.entries++;
          log(t, 'entry', key + ' ' + fill.side + ' ×' + fill.contracts + ' @' + fill.avgPrice +
            ' fee ' + fill.feeUsd);
        } else {
          stats.fillFails++;
          lastFillT.set(key, t);                 // cooldown failed entries too
        }
      } else if (exit && exit.orderId === fill.orderId) {
        pendingExit.delete(key);
        if (fill.ok) {
          const rec = positions.closeFrom(key, fill, exit.reason, t);
          if (rec) {
            store.appendTrade(rec);
            risk.settle(rec.pnlNetUsd);
            stats.exits++;
            lastFillT.set(key, t);
            log(t, 'exit', key + ' ' + rec.exitReason + ' pnl ' + rec.pnlNetUsd);
          }
        } else {
          stats.fillFails++;                     // position stays; re-evaluated next tick
        }
      }
    }
  }

  /* ------------------------------- control -------------------------------- */

  function panicExit(t) {
    risk.panic();
    onTick(t);                                   // request sells for everything now
  }

  function onDiscoveryError() { stats.discoveryErrors++; }
  function onBookError() { stats.bookErrors++; }

  /* ------------------------------- snapshot ------------------------------- */

  function snapshot(t) {
    const spotView = {};
    for (const [asset, s] of spot) {
      const sigma = s.vol.sigmaPerSqrtSec();
      spotView[asset] = {
        price: s.price, samples: s.vol.samples, warm: s.vol.warm,
        // per-√hour vol in %, the humane display unit for these horizons
        sigmaHourPct: sigma != null ? Math.round(sigma * Math.sqrt(3600) * 1000 * 100) / 1000 : null,
      };
    }
    const markets = Array.from(watched.values()).map(m => {
      const q = quotes(books.get(m.key)) || {};
      const d = m._decision || {};
      return {
        key: m.key, platform: m.platform, asset: m.asset, title: m.title,
        kind: m.kind, floor: m.floor, cap: m.cap, closeTime: m.closeTime,
        tauSec: t != null ? Math.max(0, Math.round((m.closeTime - t) / 1000)) : null,
        fair: m._fair != null ? m._fair : null,
        yesBid: q.yesBid != null ? q.yesBid : null,
        yesAsk: q.yesAsk != null ? q.yesAsk : null,
        edgeYes: d.edgeYes != null ? d.edgeYes : null,
        edgeNo: d.edgeNo != null ? d.edgeNo : null,
        status: m._status || 'new', url: m.url,
      };
    }).sort((a, b) => a.closeTime - b.closeTime);
    return { spot: spotView, markets, positions: positions.all(), stats: Object.assign({}, stats) };
  }

  return {
    onSpot, onMarkets, onBook, onTick,
    onDiscoveryError, onBookError,
    panicExit, resetVol, snapshot,
    positions,
    watchlist: () => Array.from(watched.values()),
    get watchedCount() { return watched.size; },
  };
}

module.exports = { createPipeline, UPDOWN_OPEN_GRACE_MS, FAIR_CLAMP };
