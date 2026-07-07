/* Lumen — persistent state (localStorage). */
window.Store = (function () {
  'use strict';

  const KEY = 'lumen-state-v1';

  function defaults() {
    return {
      profile: null,          // { baselineIQ, baselineEQ, source: 'test'|'manual', createdAt }
      iq: null,
      eq: null,
      weekStart: null,        // ISO date of the Monday anchoring the current week
      days: {},               // dateISO -> { games: {gameId: score}, eqScore, journal, done }
      history: [],            // weekly recap records
      scoreHistory: [],       // [{ date, iq, eq }] — baseline point + one per recalibration
      journalEntries: [],     // [{ date, prompt, text, analysis }]
      streak: 0,
      lastCompleteDay: null,  // ISO date of last fully-completed circuit
      difficulty: { logic: 2, memory: 2, verbal: 2, speed: 2 },
      pendingRecap: null,     // recap object awaiting display
    };
  }

  let state = null;

  function load() {
    if (state) return state;
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
    } catch (e) {
      state = defaults();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function reset() {
    state = defaults();
    save();
  }

  /* ---- date helpers ---- */
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function mondayOf(dateISO) {
    const d = new Date(dateISO + 'T12:00:00');
    const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - shift);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysSinceEpoch(dateISO) {
    return Math.floor(new Date(dateISO + 'T12:00:00').getTime() / 86400000);
  }

  function today() {
    const s = load();
    const t = todayISO();
    if (!s.days[t]) s.days[t] = { games: {}, eqScore: null, journal: null, done: false };
    return s.days[t];
  }

  return { load, save, reset, todayISO, mondayOf, daysSinceEpoch, today, KEY };
})();
