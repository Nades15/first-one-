/* Fairline — open paper positions: entry bookkeeping, mark-to-book, and the
 * two ways out (settle at resolution from the spot close, or an early
 * flip-exit fill). Produces the trade records the gate and the calibration
 * chart are built from. */
'use strict';

function createPositions() {
  const open = new Map();                    // marketKey -> position

  function openFrom(fill, market, decision, t) {
    const pos = {
      id: 'p' + fill.orderId,
      key: market.key, platform: market.platform, asset: market.asset,
      title: market.title, url: market.url, kind: market.kind,
      floor: market.floor, cap: market.cap, closeTime: market.closeTime,
      side: fill.side, contracts: fill.contracts,
      avgPrice: fill.avgPrice, costUsd: fill.notionalUsd, feeUsd: fill.feeUsd,
      /* entryFair is the model's probability for OUR side at entry — this is
       * what the calibration chart tests against realized outcomes. */
      entryFair: round(fill.side === 'yes' ? decision.fair : 1 - decision.fair),
      entryEdge: decision.edge,
      tEntry: t,
      markUsd: 0,
    };
    open.set(market.key, pos);
    return pos;
  }

  function markToBook(key, q) {
    const p = open.get(key);
    if (!p || !q) return;
    const bid = p.side === 'yes' ? q.yesBid : q.noBid;
    if (bid != null) p.markUsd = round(bid * p.contracts - p.costUsd - p.feeUsd);
  }

  /* Resolution: our side pays $1/contract if it won, else $0. */
  function settle(key, wonYes, spotAtClose, t) {
    const p = open.get(key);
    if (!p) return null;
    open.delete(key);
    const won = p.side === 'yes' ? wonYes : !wonYes;
    const payoutUsd = won ? p.contracts : 0;
    return tradeRecord(p, {
      exitReason: 'SETTLED', won, spotAtClose, tExit: t,
      proceedsUsd: payoutUsd, exitFeeUsd: 0,
    });
  }

  /* Early exit via a sell fill (flip-exit or panic). won is unknown — these
   * trades count for PnL and the gate but not for calibration. */
  function closeFrom(key, fill, reason, t) {
    const p = open.get(key);
    if (!p) return null;
    open.delete(key);
    return tradeRecord(p, {
      exitReason: reason, won: null, spotAtClose: null, tExit: t,
      proceedsUsd: fill.notionalUsd, exitFeeUsd: fill.feeUsd,
      exitPrice: fill.avgPrice,
    });
  }

  function tradeRecord(p, exit) {
    return {
      mode: 'paper',
      key: p.key, platform: p.platform, asset: p.asset, title: p.title,
      kind: p.kind, floor: p.floor, cap: p.cap, closeTime: p.closeTime,
      side: p.side, contracts: p.contracts,
      avgPrice: p.avgPrice, costUsd: p.costUsd,
      feeUsd: round(p.feeUsd + exit.exitFeeUsd),
      entryFair: p.entryFair, entryEdge: p.entryEdge,
      tEntry: p.tEntry, tExit: exit.tExit,
      exitReason: exit.exitReason, exitPrice: exit.exitPrice != null ? exit.exitPrice : null,
      spotAtClose: exit.spotAtClose, won: exit.won,
      pnlNetUsd: round(exit.proceedsUsd - p.costUsd - p.feeUsd - exit.exitFeeUsd),
    };
  }

  return {
    openFrom, markToBook, settle, closeFrom,
    get: key => open.get(key) || null,
    has: key => open.has(key),
    all: () => Array.from(open.values()),
    count: () => open.size,
  };
}

function round(x) { return isFinite(x) ? Math.round(x * 10000) / 10000 : x; }

module.exports = { createPositions };
