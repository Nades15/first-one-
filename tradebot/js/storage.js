/* MFFU Trade Copilot — persistent state (localStorage). */
window.TBStore = (function () {
  'use strict';

  const KEY = 'tradebot-state-v1';

  function defaults() {
    return {
      settings: {
        apiKey: '',
        model: 'claude-sonnet-5',
        planId: 'rapid25k',
        planOverrides: {},        // user-edited rule values, merged over the preset
        riskPct: 25,              // % of distance-to-breach risked per trade
        defaultInstrument: 'MNQ',
        onboarded: false,
      },
      account: {
        balance: 25000,           // current realized balance — sync with your MFFU dashboard
        days: [],                 // completed days: { date, endBalance, pnl, traded }
      },
      trades: [],                 // { id, date, instrument, dir, contracts, entry, exit, pnl, fromSignal, notes }
      signals: [],                // recent analyses (newest first, capped)
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
    out.account = Object.assign({}, base.account, saved.account || {});
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function reset() {
    state = defaults();
    save();
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return { load, save, reset, todayISO, uid, KEY };
})();
