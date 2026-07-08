/* Scout — pure scan engine: normalize raw API payloads, pick sides in the
 * probability band, filter, and rank. No DOM, no fetch — runs in node for
 * tests (scanner/test/) and in the browser as window.SCScan. */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SCScan = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Gamma encodes arrays as JSON strings ('["Yes","No"]'); tolerate both. */
  function parseMaybeJSON(v) {
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string') return null;
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : null; } catch (e) { return null; }
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  /*
   * Normalize one platform's raw market list into a common shape:
   * { platform, id, title, outcomes: [{ label, prob }], volume24h,
   *   liquidity, closeTime (ms epoch or null), url, category }
   * Polymarket lists every outcome with its own price, so both sides of a
   * binary market arrive ready-made. Kalshi only quotes the YES side, so we
   * emit YES and NO outcomes ourselves — a NO at 75% is a YES priced 25¢.
   */
  function normalizePolymarket(raw) {
    const out = [];
    for (const m of raw || []) {
      const labels = parseMaybeJSON(m.outcomes);
      const prices = parseMaybeJSON(m.outcomePrices);
      if (!labels || !prices || labels.length < 2 || labels.length !== prices.length) continue;
      const outcomes = [];
      for (let i = 0; i < labels.length; i++) {
        const p = num(prices[i]);
        if (p > 0 && p < 1) outcomes.push({ label: String(labels[i]), prob: p });
      }
      if (!outcomes.length) continue;
      const eventSlug = m.events && m.events[0] && m.events[0].slug;
      const closeMs = m.endDate ? Date.parse(m.endDate) : NaN;
      out.push({
        platform: 'polymarket',
        id: String(m.id || m.conditionId || m.slug || ''),
        title: String(m.question || m.title || ''),
        outcomes,
        volume24h: num(m.volume24hr),
        liquidity: num(m.liquidityNum != null ? m.liquidityNum : m.liquidity),
        closeTime: isNaN(closeMs) ? null : closeMs,
        url: eventSlug ? 'https://polymarket.com/event/' + eventSlug
                       : 'https://polymarket.com/market/' + (m.slug || ''),
        category: String(m.category || (m.events && m.events[0] && m.events[0].category) || ''),
      });
    }
    return out;
  }

  function normalizeKalshi(raw) {
    const out = [];
    for (const m of raw || []) {
      const bid = num(m.yes_bid), ask = num(m.yes_ask), last = num(m.last_price);
      let cents = null;
      if (bid > 0 && ask > 0 && ask < 100) cents = (bid + ask) / 2;
      else if (last > 0 && last < 100) cents = last;
      if (cents === null) continue;                    // no quote, no trade — dead book
      const prob = cents / 100;
      const title = String(m.title || '') + (m.yes_sub_title ? ' — ' + m.yes_sub_title : '');
      const series = String(m.event_ticker || m.ticker || '').split('-')[0].toLowerCase();
      const closeMs = m.close_time ? Date.parse(m.close_time) : NaN;
      out.push({
        platform: 'kalshi',
        id: String(m.ticker || ''),
        title,
        outcomes: [
          { label: 'YES', prob },
          { label: 'NO', prob: 1 - prob },
        ],
        volume24h: num(m.volume_24h),
        liquidity: num(m.open_interest),
        closeTime: isNaN(closeMs) ? null : closeMs,
        url: series ? 'https://kalshi.com/markets/' + series : 'https://kalshi.com',
        category: String(m.category || ''),
      });
    }
    return out;
  }

  /*
   * Pick the sides that land inside the probability band, apply filters,
   * and rank. Returns candidates sorted best-first:
   * { key, platform, id, title, side, prob, volume24h, liquidity,
   *   closeTime, url, category, score }
   */
  function findCandidates(markets, opts) {
    const bandLo = opts.bandLo / 100, bandHi = opts.bandHi / 100;
    const center = (bandLo + bandHi) / 2;
    const halfWidth = Math.max((bandHi - bandLo) / 2, 0.005);
    const now = opts.now != null ? opts.now : Date.now();
    const windowMs = (opts.resolveWithinHours || 0) * 3600 * 1000;
    const keyword = (opts.keyword || '').trim().toLowerCase();

    const cands = [];
    for (const m of markets || []) {
      if (m.volume24h < (opts.minVolume24h || 0)) continue;
      if (m.closeTime !== null && m.closeTime <= now) continue;        // already closing/closed
      if (windowMs > 0 && (m.closeTime === null || m.closeTime > now + windowMs)) continue;
      if (keyword && !(m.title + ' ' + m.category).toLowerCase().includes(keyword)) continue;

      /* Best in-band side only, so a wide band can't list both sides of one market. */
      let best = null;
      for (const o of m.outcomes) {
        if (o.prob < bandLo || o.prob > bandHi) continue;
        if (!best || Math.abs(o.prob - center) < Math.abs(best.prob - center)) best = o;
      }
      if (!best) continue;

      const proximity = 1 - Math.abs(best.prob - center) / halfWidth;   // 1 at center, 0 at edge
      const volume = Math.min(1, Math.log10(1 + m.volume24h) / 5);      // ≈1 at $100k/24h
      const urgency = m.closeTime === null ? 0
        : Math.max(0, 1 - (m.closeTime - now) / (30 * 24 * 3600 * 1000)); // sooner = higher
      const score = 0.45 * proximity + 0.35 * volume + 0.2 * urgency;

      cands.push({
        key: m.platform + ':' + m.id + ':' + best.label,
        platform: m.platform, id: m.id, title: m.title,
        side: best.label, prob: best.prob,
        volume24h: m.volume24h, liquidity: m.liquidity,
        closeTime: m.closeTime, url: m.url, category: m.category,
        score,
      });
    }
    cands.sort((a, b) => b.score - a.score);
    return opts.maxResults > 0 ? cands.slice(0, opts.maxResults) : cands;
  }

  return { normalizePolymarket, normalizeKalshi, findCandidates };
});
