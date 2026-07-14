/* Fairline — paper broker. Simulated fills against the REAL order book with
 * honest fees and a latency model (Livebot paperBroker pattern). Fills are
 * tick-driven, not promise-driven, so replay is fully deterministic:
 *
 *   request(action, side, marketKey, contracts, ctx) → orderId  (enqueues)
 *   onBook(marketKey, book)                                     (latest book)
 *   onTick(t) → [settled fills]   (drains orders whose target time — decision
 *       time + paperLatencyMs — has arrived, priced against the LATEST book:
 *       a move landing inside the latency window eats the fill exactly as it
 *       would live)
 *
 * One YES-side book serves both sides:
 *   buy yes  → walk asks at p        sell yes → walk bids at p
 *   buy no   → walk bids at 1−p      sell no  → walk asks at 1−p
 * Our paper order is fictional and never consumes the observed book. */
'use strict';

/* Walk levels, filling `contracts`, paying/receiving priceOf(level.p) each.
 * Partial fills are honest: you get what the book has. */
function walkLevels(levels, contracts, priceOf) {
  let filled = 0, notional = 0;
  for (const l of levels) {
    if (filled >= contracts) break;
    const take = Math.min(contracts - filled, l.s);
    filled += take;
    notional += take * priceOf(l.p);
  }
  return { contracts: filled, notionalUsd: round(notional, 4),
    avgPrice: filled > 0 ? round(notional / filled, 4) : 0 };
}

/* Kalshi's published taker fee: ceil(rate · C · P · (1−P)) to the cent.
 * The epsilon keeps float noise (0.07·100·0.25 → 1.7500000000000002) from
 * bumping an exact cent up. */
function kalshiFeeUsd(rate, contracts, price) {
  return Math.ceil(rate * contracts * price * (1 - price) * 100 - 1e-9) / 100;
}

function createPaperBroker(cfg) {
  const latencyMs = cfg.TRADE.paperLatencyMs;
  const staleMs = cfg.BOOKS.staleMs;
  const fees = cfg.FEES;
  const books = new Map();                   // marketKey -> canonical book
  const pending = [];                        // { orderId, action, side, marketKey, contracts, platform, targetT }
  let seq = 0;

  function request(action, side, marketKey, contracts, ctx) {
    const orderId = ++seq;
    pending.push({ orderId, action, side, marketKey, contracts,
      platform: ctx.platform, targetT: ctx.t + latencyMs });
    return orderId;
  }

  function onBook(marketKey, book) { books.set(marketKey, book); }

  function feeFor(platform, contracts, avgPrice) {
    if (!contracts) return 0;
    if (platform === 'kalshi') return kalshiFeeUsd(fees.kalshiFeeRate, contracts, avgPrice);
    return round((fees.polymarketFeePct / 100) * contracts * avgPrice, 4);
  }

  function fill(o, book, t) {
    if (!book || t - book.t > staleMs) {
      return { ok: false, failReason: 'NO_BOOK', t };
    }
    const buying = o.action === 'buy';
    // Side × action picks the levels and the price transform (see header).
    // Both orderings are already best-first for their taker: asks ascend in
    // p (cheapest YES / richest NO-sale first), bids descend (richest
    // YES-sale / cheapest NO first).
    const levels = (o.side === 'yes') === buying ? book.asks : book.bids;
    const priceOf = o.side === 'yes' ? (p => p) : (p => 1 - p);
    const w = walkLevels(levels, o.contracts, priceOf);
    if (w.contracts < 1) return { ok: false, failReason: 'NO_DEPTH', t };
    const feeUsd = feeFor(o.platform, w.contracts, w.avgPrice);
    return { ok: true, t, contracts: w.contracts, avgPrice: w.avgPrice,
      notionalUsd: w.notionalUsd, feeUsd };
  }

  function onTick(t) {
    const settled = [];
    for (let i = pending.length - 1; i >= 0; i--) {
      const o = pending[i];
      if (t < o.targetT) continue;
      pending.splice(i, 1);
      const res = fill(o, books.get(o.marketKey), t);
      settled.push(Object.assign(res, { orderId: o.orderId, action: o.action,
        side: o.side, marketKey: o.marketKey, requested: o.contracts }));
    }
    return settled.sort((a, b) => a.orderId - b.orderId);
  }

  function cancelForMarket(marketKey) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].marketKey === marketKey) pending.splice(i, 1);
    }
  }

  function pendingCount() { return pending.length; }

  return { request, onBook, onTick, cancelForMarket, pendingCount, mode: 'paper' };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createPaperBroker, walkLevels, kalshiFeeUsd };
