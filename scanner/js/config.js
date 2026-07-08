/* Scout — endpoints, filter defaults, and Claude model list. */
window.SCConfig = (function () {
  'use strict';

  /*
   * Market-data endpoints. Both are public read-only APIs — no key needed.
   * Kalshi has two hosts that serve the same v2 API; we try them in order.
   * If a host refuses browser calls (CORS), platforms.js retries the same
   * URL through the proxy configured in Settings.
   */
  const POLYMARKET_API = 'https://gamma-api.polymarket.com';
  const KALSHI_APIS = [
    'https://api.elections.kalshi.com/trade-api/v2',
    'https://external-api.kalshi.com/trade-api/v2',
  ];

  const DEFAULT_CORS_PROXY = 'https://corsproxy.io/?url=';

  /* How many pages each platform is asked for per scan depth.
   * Polymarket pages are 500 markets ordered by 24h volume (liquid first);
   * Kalshi pages are 1000 markets, server-filtered by close time when a
   * resolves-within window is set. */
  const DEPTHS = {
    quick:    { label: 'Quick (~30s)',   polymarketPages: 1, kalshiPages: 1 },
    standard: { label: 'Standard',       polymarketPages: 3, kalshiPages: 3 },
    deep:     { label: 'Deep (slower)',  polymarketPages: 6, kalshiPages: 6 },
  };

  const WINDOWS = [
    { hours: 24,  label: 'Resolves within 24 hours' },
    { hours: 72,  label: 'Resolves within 3 days' },
    { hours: 168, label: 'Resolves within 7 days' },
    { hours: 720, label: 'Resolves within 30 days' },
    { hours: 0,   label: 'Any resolution date' },
  ];

  /* The "75% zone" — one side of the market priced 70–80¢. */
  const FILTER_DEFAULTS = {
    platforms: { polymarket: true, kalshi: true },
    bandLo: 70,                // %
    bandHi: 80,                // %
    minVolume24h: 1000,        // $ on Polymarket, contracts on Kalshi
    resolveWithinHours: 168,
    depth: 'standard',
    keyword: '',
    maxResults: 30,
  };

  const AI_TOP_N = 10;         // candidates sent per AI second-opinion call

  const MODELS = [
    { id: 'claude-sonnet-5',           label: 'Claude Sonnet 5 (recommended)' },
    { id: 'claude-fable-5',            label: 'Claude Fable 5 (most capable, pricier)' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (cheapest, weaker reads)' },
  ];

  return { POLYMARKET_API, KALSHI_APIS, DEFAULT_CORS_PROXY, DEPTHS, WINDOWS, FILTER_DEFAULTS, AI_TOP_N, MODELS };
})();
