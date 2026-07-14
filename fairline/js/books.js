/* Fairline — executable prices. Polls each watched market's real order book
 * and normalizes it to one canonical YES-side shape:
 *
 *   { t, bids: [{p,s}…highest first], asks: [{p,s}…lowest first] }
 *
 * p is the YES price in dollars-probability [0,1]; s is contracts. A NO
 * position trades against the same book from the other side (buying NO
 * consumes YES bids at cost 1−p), so one book per market covers both sides.
 *
 * Polymarket: CLOB REST `/book?token_id=` for the YES token. Kalshi:
 * `/markets/{ticker}/orderbook`, which lists resting YES bids and NO bids —
 * YES asks are the NO bids complemented (ask 1−p, same size). REST polling
 * keeps v1 simple and replayable; a CLOB websocket is a later upgrade. */
'use strict';

const num = v => { const n = Number(v); return isFinite(n) ? n : NaN; };

function level(p, s) {
  return (isFinite(p) && p > 0 && p < 1 && isFinite(s) && s > 0)
    ? { p: Math.round(p * 1000) / 1000, s } : null;
}

/* ----------------------------- normalizers ----------------------------- */

/* Polymarket /book: { bids:[{price,size}…], asks:[{price,size}…] } (strings). */
function normalizePolymarketBook(raw, t) {
  if (!raw || !Array.isArray(raw.bids) || !Array.isArray(raw.asks)) return null;
  const bids = raw.bids.map(l => level(num(l.price), num(l.size))).filter(Boolean)
    .sort((a, b) => b.p - a.p);
  const asks = raw.asks.map(l => level(num(l.price), num(l.size))).filter(Boolean)
    .sort((a, b) => a.p - b.p);
  return { t, bids, asks };
}

/* Kalshi /orderbook: { orderbook: { yes:[[cents,count]…], no:[[cents,count]…] } }
 * yes = resting YES bids; no = resting NO bids ⇒ YES asks at 1 − p. */
function normalizeKalshiBook(raw, t) {
  const ob = raw && raw.orderbook;
  if (!ob) return null;
  const bids = (ob.yes || []).map(l => level(num(l[0]) / 100, num(l[1]))).filter(Boolean)
    .sort((a, b) => b.p - a.p);
  const asks = (ob.no || []).map(l => level(1 - num(l[0]) / 100, num(l[1]))).filter(Boolean)
    .sort((a, b) => a.p - b.p);
  return { t, bids, asks };
}

/* ---------------------------- quote helpers ---------------------------- */

/* Top-of-book view for the strategy: what buying/selling each side costs
 * right now, and how much size sits at those prices. */
function quotes(book) {
  if (!book) return null;
  const bb = book.bids[0] || null, ba = book.asks[0] || null;
  return {
    yesBid: bb ? bb.p : null, yesBidSize: bb ? bb.s : 0,
    yesAsk: ba ? ba.p : null, yesAskSize: ba ? ba.s : 0,
    noBid: ba ? Math.round((1 - ba.p) * 1000) / 1000 : null, noBidSize: ba ? ba.s : 0,
    noAsk: bb ? Math.round((1 - bb.p) * 1000) / 1000 : null, noAskSize: bb ? bb.s : 0,
    mid: bb && ba ? Math.round((bb.p + ba.p) / 2 * 1000) / 1000 : null,
  };
}

/* ------------------------------- fetcher -------------------------------- */

async function getJSON(url, fetchImpl) {
  const res = await (fetchImpl || fetch)(url, { headers: { accept: 'application/json' } });
  if (!res.ok) { const e = new Error('HTTP ' + res.status + ' ' + url); e.status = res.status; throw e; }
  return res.json();
}

async function fetchBook(market, cfg, fetchImpl, t) {
  if (market.platform === 'polymarket') {
    const raw = await getJSON(cfg.clobApi + '/book?token_id=' + encodeURIComponent(market.tokenIds[0]), fetchImpl);
    return normalizePolymarketBook(raw, t);
  }
  let lastErr = null;
  for (const base of cfg.kalshiApis) {
    try {
      const raw = await getJSON(base + '/markets/' + encodeURIComponent(market.id) + '/orderbook', fetchImpl);
      return normalizeKalshiBook(raw, t);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* Round-robin book poller for the current watchlist. Sequential (one request
 * at a time) to stay gentle on both APIs; onBook(marketKey, book) fires per
 * refreshed market. */
function createBookPoller(opts) {
  const cfg = opts.cfg;                          // { ...CONFIG.BOOKS, ...CONFIG.DISCOVERY endpoints }
  const fetchImpl = opts.fetchImpl;
  const onBook = opts.onBook || (() => {});
  const onError = opts.onError || (() => {});
  const now = opts.now || (() => Date.now());
  let markets = [];
  let timer = null, running = false;

  async function poll() {
    if (running) return;
    running = true;
    for (const m of markets.slice()) {
      try {
        const book = await fetchBook(m, cfg, fetchImpl, now());
        if (book) onBook(m.key, book);
      } catch (e) { onError(m.key, e); }
    }
    running = false;
  }

  return {
    setMarkets(list) { markets = list || []; },
    start() { poll(); timer = setInterval(poll, cfg.pollMs); if (timer.unref) timer.unref(); },
    stop() { clearInterval(timer); },
    poll,
  };
}

module.exports = {
  normalizePolymarketBook, normalizeKalshiBook, quotes, fetchBook, createBookPoller,
};
