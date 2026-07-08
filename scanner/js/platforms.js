/* Scout — Polymarket & Kalshi market-data clients.
 * Both APIs are public and keyless. Every request tries a direct browser
 * fetch first; if the host blocks cross-origin calls, the same URL is
 * retried through the CORS proxy configured in Settings, and the working
 * mode is remembered per host for the rest of the session. */
window.SCPlatforms = (function () {
  'use strict';

  const modeByHost = {};   // host -> 'direct' | 'proxy'

  function isMock() {
    return new URLSearchParams(location.search).get('mock') === '1' || window.__SC_MOCK__;
  }

  async function tryFetch(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error('HTTP ' + res.status + (res.status === 429 ? ' (rate limited — wait a minute)' : '') +
        (body ? ': ' + body.slice(0, 120) : ''));
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function fetchJSON(url, proxy) {
    const host = new URL(url).host;
    if (modeByHost[host] !== 'proxy') {
      try {
        const data = await tryFetch(url);
        modeByHost[host] = 'direct';
        return data;
      } catch (err) {
        // HTTP errors mean the host is reachable — a proxy won't help.
        if (err.status) throw err;
        if (!proxy) throw new Error('Could not reach ' + host + ' from the browser (likely CORS). Set a CORS proxy in Settings.');
      }
    }
    const data = await tryFetch(proxy + encodeURIComponent(url));
    modeByHost[host] = 'proxy';
    return data;
  }

  /* ------------------------- Polymarket (Gamma) ------------------------- */

  async function fetchPolymarket({ pages, resolveWithinHours, proxy, onProgress }) {
    if (isMock()) return mockPolymarket();
    const limit = 500;
    const all = [];
    for (let page = 0; page < pages; page++) {
      let url = SCConfig.POLYMARKET_API + '/markets?active=true&closed=false' +
        '&order=volume24hr&ascending=false&limit=' + limit + '&offset=' + page * limit;
      if (resolveWithinHours > 0) {
        url += '&end_date_min=' + encodeURIComponent(new Date().toISOString()) +
               '&end_date_max=' + encodeURIComponent(new Date(Date.now() + resolveWithinHours * 3600e3).toISOString());
      }
      const batch = await fetchJSON(url, proxy);
      if (!Array.isArray(batch) || !batch.length) break;
      all.push(...batch);
      if (onProgress) onProgress('polymarket', all.length);
      if (batch.length < limit) break;
    }
    return all;
  }

  /* ------------------------------ Kalshi ------------------------------- */

  async function kalshiFetch(path, proxy) {
    let lastErr = null;
    for (const base of SCConfig.KALSHI_APIS) {
      try { return await fetchJSON(base + path, proxy); } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }

  async function fetchKalshi({ pages, resolveWithinHours, proxy, onProgress }) {
    if (isMock()) return mockKalshi();
    const nowSec = Math.floor(Date.now() / 1000);
    let query = '?status=open&limit=1000&min_close_ts=' + nowSec;
    if (resolveWithinHours > 0) query += '&max_close_ts=' + (nowSec + resolveWithinHours * 3600);
    const all = [];
    let cursor = '';
    for (let page = 0; page < pages; page++) {
      const data = await kalshiFetch('/markets' + query + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), proxy);
      const batch = (data && data.markets) || [];
      if (!batch.length) break;
      all.push(...batch);
      if (onProgress) onProgress('kalshi', all.length);
      cursor = data.cursor;
      if (!cursor) break;
    }
    return all;
  }

  /* -------------------- single-market refresh (watchlist) -------------------- */

  /* Returns a map of candidate.key -> fresh prob for that candidate's side
   * (missing keys = market gone or fetch failed). */
  async function refreshCandidates(cands, proxy) {
    const fresh = {};
    for (const c of cands) {
      try {
        let markets;
        if (isMock()) {
          markets = [{ platform: c.platform, id: c.id, title: c.title,
            outcomes: [{ label: c.side, prob: Math.min(0.98, Math.max(0.02, c.prob + (Math.random() - 0.45) * 0.06)) }],
            volume24h: c.volume24h, liquidity: c.liquidity, closeTime: c.closeTime, url: c.url, category: c.category }];
        } else if (c.platform === 'polymarket') {
          const m = await fetchJSON(SCConfig.POLYMARKET_API + '/markets/' + encodeURIComponent(c.id), proxy);
          markets = SCScan.normalizePolymarket([m]);
        } else {
          const data = await kalshiFetch('/markets/' + encodeURIComponent(c.id), proxy);
          markets = SCScan.normalizeKalshi([data && data.market]);
        }
        const m = markets && markets[0];
        const side = m && m.outcomes.find(o => o.label === c.side);
        if (side) fresh[c.key] = side.prob;
      } catch (err) { /* leave this one stale */ }
    }
    return fresh;
  }

  /* ------------------------------ mock data ------------------------------ */
  /* Canned raw payloads in each API's real shape, with close times relative
   * to "now" so the window filters behave. Open /scanner/?mock=1 to use. */

  const hrs = h => new Date(Date.now() + h * 3600e3).toISOString();

  function mockPolymarket() {
    return Promise.resolve([
      { id: '501', question: 'Will the Fed cut rates at the September meeting?',
        outcomes: '["Yes","No"]', outcomePrices: '["0.76","0.24"]', volume24hr: 184000, liquidityNum: 420000,
        endDate: hrs(24 * 5), slug: 'fed-cut-september', category: 'Economics',
        events: [{ slug: 'fed-decision-september', category: 'Economics' }] },
      { id: '502', question: 'Will Bitcoin close above $100k this week?',
        outcomes: '["Yes","No"]', outcomePrices: '["0.28","0.72"]', volume24hr: 96000, liquidityNum: 150000,
        endDate: hrs(24 * 3), slug: 'btc-100k-week', category: 'Crypto',
        events: [{ slug: 'btc-100k-week', category: 'Crypto' }] },
      { id: '503', question: 'Will the heat wave break record highs in Phoenix tomorrow?',
        outcomes: '["Yes","No"]', outcomePrices: '["0.81","0.19"]', volume24hr: 12000, liquidityNum: 30000,
        endDate: hrs(30), slug: 'phoenix-heat-record', category: 'Weather',
        events: [{ slug: 'phoenix-heat-record', category: 'Weather' }] },
      { id: '504', question: 'Champions League: will the favorite win the final?',
        outcomes: '["Yes","No"]', outcomePrices: '["0.74","0.26"]', volume24hr: 310000, liquidityNum: 800000,
        endDate: hrs(24 * 6), slug: 'ucl-final-favorite', category: 'Sports',
        events: [{ slug: 'ucl-final', category: 'Sports' }] },
      { id: '505', question: 'Will candidate X win the runoff?',
        outcomes: '["Yes","No"]', outcomePrices: '["0.55","0.45"]', volume24hr: 500000, liquidityNum: 900000,
        endDate: hrs(24 * 20), slug: 'runoff-x', category: 'Politics',
        events: [{ slug: 'runoff-x', category: 'Politics' }] },
      { id: '506', question: 'Will the album debut at #1 this week?',
        outcomes: '["Yes","No"]', outcomePrices: '["0.77","0.23"]', volume24hr: 400, liquidityNum: 2000,
        endDate: hrs(24 * 4), slug: 'album-number-one', category: 'Pop Culture',
        events: [{ slug: 'album-number-one', category: 'Pop Culture' }] },
    ]);
  }

  function mockKalshi() {
    return Promise.resolve([
      { ticker: 'KXHIGHNY-26JUL12-B85', event_ticker: 'KXHIGHNY-26JUL12', category: 'Climate',
        title: 'Highest temperature in NYC on Jul 12', yes_sub_title: '85° or above',
        yes_bid: 74, yes_ask: 77, last_price: 75, volume_24h: 21000, open_interest: 65000, close_time: hrs(24 * 4) },
      { ticker: 'KXCPI-26JUL-T3.0', event_ticker: 'KXCPI-26JUL', category: 'Economics',
        title: 'CPI year-over-year for July', yes_sub_title: 'Above 3.0%',
        yes_bid: 22, yes_ask: 25, last_price: 24, volume_24h: 48000, open_interest: 120000, close_time: hrs(24 * 6) },
      { ticker: 'KXNBAFINALS-26-LAL', event_ticker: 'KXNBAFINALS-26', category: 'Sports',
        title: 'NBA Finals winner', yes_sub_title: 'Lakers',
        yes_bid: 78, yes_ask: 80, last_price: 79, volume_24h: 150000, open_interest: 400000, close_time: hrs(24 * 2) },
      { ticker: 'KXSHUTDOWN-26AUG', event_ticker: 'KXSHUTDOWN-26AUG', category: 'Politics',
        title: 'Government shutdown before September', yes_sub_title: '',
        yes_bid: 8, yes_ask: 11, last_price: 9, volume_24h: 32000, open_interest: 90000, close_time: hrs(24 * 6.5) },
      { ticker: 'KXDEADBOOK-26', event_ticker: 'KXDEADBOOK-26', category: 'Other',
        title: 'Dead order book market', yes_sub_title: '',
        yes_bid: 0, yes_ask: 0, last_price: 0, volume_24h: 0, open_interest: 0, close_time: hrs(24 * 5) },
    ]);
  }

  return { fetchPolymarket, fetchKalshi, refreshCandidates, isMock };
})();
