/* Fairline — market discovery. Sweeps Polymarket (Gamma) and Kalshi for
 * short-horizon crypto markets the fair model can actually price, and
 * normalizes them to one shape:
 *
 *   { key, platform, id, asset, kind, floor, cap, closeTime, windowStart,
 *     title, url, yesLabel, tokenIds }
 *
 * Every market prices as P(floor < spot ≤ cap at closeTime):
 *   "above $K"          → floor=K,  cap=null
 *   "below $K"          → floor=null, cap=K
 *   Kalshi range        → floor=K1, cap=K2
 *   hourly up-or-down   → floor = the window's OPEN price, captured live by
 *                         the pipeline at windowStart; unpriceable (skipped)
 *                         if the bot wasn't watching when the window opened.
 *
 * Touch/barrier wordings ("reach", "hit", "dip to") are deliberately
 * excluded — they resolve on the path, not the terminal price, and the
 * terminal-value model would misprice them. Pure normalizers are separated
 * from fetchers (Scout platforms.js pattern); fetchImpl is injectable. */
'use strict';

/* ---------------------------- asset matching ---------------------------- */

const ASSET_WORDS = [
  { asset: 'BTC', re: /\b(bitcoin|btc)\b/i },
  { asset: 'ETH', re: /\b(ethereum|eth)\b/i },
  { asset: 'SOL', re: /\b(solana)\b/i },       // bare "sol" collides with normal words
];

function detectAsset(text) {
  for (const w of ASSET_WORDS) if (w.re.test(text)) return w.asset;
  return null;
}

const BARRIER_RE = /\b(reach|hit|touch|dip|flip)\b/i;
const num = v => { const n = Number(v); return isFinite(n) ? n : NaN; };

/* Up-or-down window length from the title's time range — Polymarket runs
 * 5m / 15m / hourly series and the range in the question ("…July 15,
 * 3:35PM-3:40PM ET") is the only reliable source of the window length.
 * Returns ms, or null when no plausible range is present (old hourly titles
 * carry a single time; callers fall back to cfg.updownWindowMs). */
const WINDOW_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i;

function parseWindowMs(text) {
  const m = WINDOW_RANGE_RE.exec(text || '');
  if (!m) return null;
  const mins = (h, mm, ap) =>
    ((Number(h) % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0)) * 60 + (mm ? Number(mm) : 0);
  const dur = (mins(m[4], m[5], m[6]) - mins(m[1], m[2], m[3]) + 1440) % 1440;
  const ms = dur * 60e3;
  return ms >= 60e3 && ms <= 12 * 3600e3 ? ms : null;
}

function parseDollars(s) {
  const n = Number(String(s).replace(/[,$]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

/* ------------------------- Polymarket normalizer ------------------------ */

function normalizePolymarket(raws, nowMs, cfg) {
  const out = [];
  for (const raw of raws || []) {
    if (!raw || !raw.id || !raw.question || !raw.endDate) continue;
    const closeTime = Date.parse(raw.endDate);
    if (!isFinite(closeTime) || closeTime <= nowMs) continue;
    const text = raw.question + ' ' + (raw.slug || '');
    const asset = detectAsset(text);
    if (!asset || BARRIER_RE.test(raw.question)) continue;

    let tokenIds = null;
    try { tokenIds = JSON.parse(raw.clobTokenIds || 'null'); } catch (e) {}
    if (!Array.isArray(tokenIds) || tokenIds.length < 2) continue;

    let outcomes = null;
    try { outcomes = JSON.parse(raw.outcomes || 'null'); } catch (e) {}

    const base = {
      platform: 'polymarket',
      id: String(raw.id),
      key: 'polymarket:' + raw.id,
      asset, closeTime,
      title: raw.question,
      url: 'https://polymarket.com/market/' + (raw.slug || raw.id),
      tokenIds: tokenIds.map(String),
      yesLabel: Array.isArray(outcomes) && outcomes[0] ? String(outcomes[0]) : 'Yes',
      windowStart: null,
    };

    const above = raw.question.match(/\babove\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
    const below = raw.question.match(/\bbelow\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
    if (above && parseDollars(above[1])) {
      out.push(Object.assign(base, { kind: 'above', floor: parseDollars(above[1]), cap: null }));
    } else if (below && parseDollars(below[1])) {
      out.push(Object.assign(base, { kind: 'below', floor: null, cap: parseDollars(below[1]) }));
    } else if (/\bup or down\b/i.test(text)) {
      const windowMs = parseWindowMs(raw.question) || cfg.updownWindowMs;
      out.push(Object.assign(base, {
        kind: 'updown', floor: null, cap: null,
        windowStart: closeTime - windowMs,
      }));
    }
  }
  return out;
}

/* --------------------------- Kalshi normalizer -------------------------- */

function normalizeKalshi(raws, nowMs) {
  const out = [];
  for (const raw of raws || []) {
    if (!raw || !raw.ticker || !raw.close_time) continue;
    const closeTime = Date.parse(raw.close_time);
    if (!isFinite(closeTime) || closeTime <= nowMs) continue;
    const asset = kalshiAsset(raw);
    if (!asset) continue;

    const floor = isFinite(num(raw.floor_strike)) ? num(raw.floor_strike) : null;
    const cap = isFinite(num(raw.cap_strike)) ? num(raw.cap_strike) : null;
    let kind = null;
    switch (raw.strike_type) {
      case 'greater': if (floor != null) kind = 'above'; break;
      case 'less':    if (cap != null) kind = 'below'; break;
      case 'between': if (floor != null && cap != null) kind = 'range'; break;
      default: break;                        // structured strikes only — no title parsing
    }
    if (!kind) continue;

    out.push({
      platform: 'kalshi',
      id: raw.ticker,
      key: 'kalshi:' + raw.ticker,
      asset, kind,
      floor: kind === 'below' ? null : floor,
      cap: kind === 'above' ? null : cap,
      closeTime, windowStart: null,
      title: (raw.title || raw.ticker) + (raw.yes_sub_title ? ' — ' + raw.yes_sub_title : ''),
      url: 'https://kalshi.com/markets/' + String(raw.event_ticker || raw.ticker).toLowerCase(),
      tokenIds: null,
      yesLabel: 'Yes',
    });
  }
  return out;
}

function kalshiAsset(raw) {
  const t = String(raw.event_ticker || raw.ticker);
  if (/^KX?BTC/i.test(t)) return 'BTC';
  if (/^KX?ETH/i.test(t)) return 'ETH';
  if (/^KX?SOL/i.test(t)) return 'SOL';
  return detectAsset(raw.title || '');
}

/* ---------------------------- watchlist pick ---------------------------- */

/* Soonest-closing first, capped, deduped by key. Markets past the horizon or
 * for assets the spot feed doesn't carry are dropped. */
function selectWatchlist(markets, nowMs, cfg, assets) {
  const seen = new Set();
  return markets
    .filter(m => m.closeTime > nowMs && m.closeTime <= nowMs + cfg.horizonMs)
    .filter(m => !assets || assets.includes(m.asset))
    .filter(m => (seen.has(m.key) ? false : seen.add(m.key)))
    .sort((a, b) => a.closeTime - b.closeTime)
    .slice(0, cfg.maxMarkets);
}

/* ------------------------------- fetchers ------------------------------- */

async function getJSON(url, fetchImpl) {
  const res = await (fetchImpl || fetch)(url, { headers: { accept: 'application/json' } });
  if (!res.ok) { const e = new Error('HTTP ' + res.status + ' ' + url); e.status = res.status; throw e; }
  return res.json();
}

async function fetchPolymarketRaw(cfg, fetchImpl, nowMs) {
  const url = cfg.polymarketApi + '/markets?active=true&closed=false&limit=500' +
    '&order=endDate&ascending=true' +
    '&end_date_min=' + encodeURIComponent(new Date(nowMs).toISOString()) +
    '&end_date_max=' + encodeURIComponent(new Date(nowMs + cfg.horizonMs).toISOString());
  const data = await getJSON(url, fetchImpl);
  return Array.isArray(data) ? data : [];
}

async function fetchKalshiRaw(cfg, fetchImpl, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const q = '/markets?status=open&limit=1000&min_close_ts=' + nowSec +
    '&max_close_ts=' + (nowSec + Math.floor(cfg.horizonMs / 1000));
  let lastErr = null;
  for (const base of cfg.kalshiApis) {
    try {
      const data = await getJSON(base + q, fetchImpl);
      return (data && data.markets) || [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* Periodic discovery loop. onMarkets receives the selected watchlist; errors
 * are reported (not thrown) so one platform being down doesn't stop the
 * other. */
function createDiscovery(opts) {
  const cfg = opts.cfg;                          // CONFIG.DISCOVERY
  const fetchImpl = opts.fetchImpl;
  const onMarkets = opts.onMarkets || (() => {});
  const onError = opts.onError || (() => {});
  const now = opts.now || (() => Date.now());
  const assets = opts.assets || null;            // e.g. Object.keys(CONFIG.SPOT.assets)
  let timer = null, running = false;

  async function sweep() {
    if (running) return;                         // no overlapping sweeps
    running = true;
    const t = now();
    const found = [];
    if (cfg.polymarket) {
      try { found.push(...normalizePolymarket(await fetchPolymarketRaw(cfg, fetchImpl, t), t, cfg)); }
      catch (e) { onError('polymarket', e); }
    }
    if (cfg.kalshi) {
      try { found.push(...normalizeKalshi(await fetchKalshiRaw(cfg, fetchImpl, t), t)); }
      catch (e) { onError('kalshi', e); }
    }
    running = false;
    onMarkets(selectWatchlist(found, t, cfg, assets), t);
  }

  return {
    start() { sweep(); timer = setInterval(sweep, cfg.refreshMs); if (timer.unref) timer.unref(); },
    stop() { clearInterval(timer); },
    sweep,
  };
}

module.exports = {
  detectAsset, parseWindowMs, normalizePolymarket, normalizeKalshi, selectWatchlist,
  fetchPolymarketRaw, fetchKalshiRaw, createDiscovery,
};
