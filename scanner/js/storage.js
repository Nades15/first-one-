/* Scout — persistent state (localStorage). */
window.SCStore = (function () {
  'use strict';

  const KEY = 'scout-state-v1';

  function defaults() {
    return {
      settings: {
        apiKey: '',
        model: 'claude-sonnet-5',
        corsProxy: SCConfig.DEFAULT_CORS_PROXY,
        filters: Object.assign({}, SCConfig.FILTER_DEFAULTS, {
          platforms: Object.assign({}, SCConfig.FILTER_DEFAULTS.platforms),
        }),
        aiTopN: SCConfig.AI_TOP_N,
        onboarded: false,
      },
      /* Last scan kept so reopening the app shows results instantly.
       * candidates carry any AI opinions merged in as candidate.ai. */
      lastScan: null,           // { when, params, scanned, candidates: [...] }
      watchlist: [],            // candidate + { savedAt, savedProb }
    };
  }

  let state = null;

  function load() {
    if (state) return state;
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? deepMerge(defaults(), JSON.parse(raw)) : defaults();
    } catch (e) {
      state = defaults();
    }
    return state;
  }

  /* Shallow-per-section merge so new fields added in updates get defaults. */
  function deepMerge(base, saved) {
    const out = Object.assign({}, base, saved);
    out.settings = Object.assign({}, base.settings, saved.settings || {});
    out.settings.filters = Object.assign({}, base.settings.filters, (saved.settings || {}).filters || {});
    out.settings.filters.platforms = Object.assign({}, base.settings.filters.platforms,
      ((saved.settings || {}).filters || {}).platforms || {});
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function reset() {
    state = defaults();
    save();
  }

  return { load, save, reset, KEY };
})();
