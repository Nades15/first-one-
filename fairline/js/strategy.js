/* Fairline — pure decision logic. Given one market's fair probability, its
 * live book, and any open position, decide buy_yes / buy_no / exit / null.
 * No IO, no clocks of its own — fully unit-testable.
 *
 * Edges are NET of the estimated taker fee at the executable price. The
 * broker charges the exact fee at fill time; the estimate here only gates
 * the decision. */
'use strict';

const { quotes } = require('./books.js');

/* Estimated fee per contract at a given price, in dollars. */
function feePerContract(platform, price, fees) {
  if (platform === 'kalshi') return fees.kalshiFeeRate * price * (1 - price);
  return (fees.polymarketFeePct / 100) * price;
}

/* evaluate(opts) → { action, side, contracts, price, edge, fair, q, reason }
 *   market   normalized market (markets.js) with floor/cap resolved
 *   book     canonical YES-side book (books.js), or null
 *   fair     model P(YES) ∈ [0,1], or null when unpriceable
 *   position open position for this market ({ side, avgPrice, contracts }) or null
 *   t        engine time (ms); tauSec derived from market.closeTime
 *   lastFillT last fill time for this market (cooldown), or 0
 *   cfg      { strategy: CONFIG.STRATEGY, books: CONFIG.BOOKS, fees: CONFIG.FEES,
 *              sizeUsd } */
function evaluate(opts) {
  const { market, book, fair, position, t, lastFillT, cfg } = opts;
  const S = cfg.strategy;
  const hold = (reason, extra) => Object.assign({ action: null, reason, fair }, extra);

  if (fair == null || !isFinite(fair)) return hold('UNPRICEABLE');
  if (!book || !book.bids || !book.asks) return hold('NO_BOOK');
  if (t - book.t > cfg.books.staleMs) return hold('STALE_BOOK');
  const q = quotes(book);
  const tauSec = (market.closeTime - t) / 1000;

  /* ------------------------------- exits -------------------------------- */
  /* Held side now OVER-priced relative to fair by exitFlipEdge ⇒ the market
   * has come to us (or the model flipped) — take the book's price. Otherwise
   * hold to resolution; settlement is the pipeline's job. */
  if (position) {
    if (position.side === 'yes' && q.yesBid != null && q.yesBid - fair >= S.exitFlipEdge) {
      return { action: 'exit', side: 'yes', contracts: position.contracts, price: q.yesBid,
        edge: round(q.yesBid - fair), fair, q, reason: 'FLIP_EXIT' };
    }
    if (position.side === 'no' && q.noBid != null && q.noBid - (1 - fair) >= S.exitFlipEdge) {
      return { action: 'exit', side: 'no', contracts: position.contracts, price: q.noBid,
        edge: round(q.noBid - (1 - fair)), fair, q, reason: 'FLIP_EXIT' };
    }
    return hold('HOLDING', { q });
  }

  /* ------------------------------ entries ------------------------------- */
  if (tauSec < S.minTauSec) return hold('TOO_CLOSE', { q });
  if (tauSec > S.maxTauSec) return hold('TOO_FAR', { q });
  if (lastFillT && t - lastFillT < S.cooldownMs) return hold('COOLDOWN', { q });

  const edgeYes = q.yesAsk != null
    ? fair - q.yesAsk - feePerContract(market.platform, q.yesAsk, cfg.fees) : -Infinity;
  const edgeNo = q.noAsk != null
    ? (1 - fair) - q.noAsk - feePerContract(market.platform, q.noAsk, cfg.fees) : -Infinity;

  const best = edgeYes >= edgeNo
    ? { side: 'yes', edge: edgeYes, price: q.yesAsk, depth: q.yesAskSize }
    : { side: 'no', edge: edgeNo, price: q.noAsk, depth: q.noAskSize };

  if (!(best.edge >= S.minEdge)) {
    return hold('NO_EDGE', { q, edgeYes: round(edgeYes), edgeNo: round(edgeNo) });
  }
  if (best.depth < cfg.books.minDepthContracts) {
    return hold('THIN_BOOK', { q, edgeYes: round(edgeYes), edgeNo: round(edgeNo) });
  }

  const contracts = Math.min(Math.floor(cfg.sizeUsd / best.price), best.depth);
  if (contracts < 1) return hold('SIZE_ZERO', { q });

  return {
    action: best.side === 'yes' ? 'buy_yes' : 'buy_no',
    side: best.side, contracts, price: best.price,
    edge: round(best.edge), fair, q,
    edgeYes: round(edgeYes), edgeNo: round(edgeNo),
    reason: 'EDGE',
  };
}

/* Deterministic YES resolution from the spot price at close: every market
 * kind reduces to floor < spot ≤ cap (null = unbounded). */
function resolveYes(market, spotAtClose) {
  if (!(spotAtClose > 0)) return null;
  if (market.floor == null && market.cap == null) return null;   // never priced (missed up/down open)
  return (market.floor == null || spotAtClose > market.floor) &&
         (market.cap == null || spotAtClose <= market.cap);
}

function round(x) { return isFinite(x) ? Math.round(x * 10000) / 10000 : x; }

module.exports = { evaluate, resolveYes, feePerContract };
