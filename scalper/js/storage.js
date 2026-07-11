/* Pulse — persistent state (localStorage). */
window.SXStore = (function () {
  'use strict';

  const KEY = 'scalper-state-v1';

  function defaults() {
    return {
      settings: {
        buySizeSol: SXConfig.TRADE.buySizeSol,
        solUsd: SXConfig.SOL_USD,
        explicitLabels: false,   // show real scenario names instead of "Mystery token"
        exitOverrides: {},       // user-edited EXIT thresholds, merged over SXConfig.EXIT
        onboarded: false,
      },
      trades: [],                // newest first, capped at SXConfig.HISTORY_CAP
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
    out.settings.exitOverrides = Object.assign({}, (saved.settings || {}).exitOverrides || {});
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function reset() {
    state = defaults();
    save();
  }

  /* Effective exit config: defaults with the user's overrides on top. */
  function exitConfig() {
    return Object.assign({}, SXConfig.EXIT, load().settings.exitOverrides);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return { load, save, reset, exitConfig, uid, KEY };
})();
