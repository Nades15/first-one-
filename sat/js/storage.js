/* Summit — persistent state (localStorage). The question bank itself lives
 * in IndexedDB / data files (see bank.js); this is just the student. */
window.SMStore = (function () {
  'use strict';

  const KEY = 'summit-state-v1';

  function defaults() {
    return {
      settings: {
        onboarded: false,
        focus: 'both',                 // 'both' | 'rw' | 'math'
        corsProxy: SMConfig.DEFAULT_CORS_PROXY,
      },
      profile: null,                   // SMAdaptive profile, created at onboarding
      seen: {},                        // qid -> { correct, at, section, domain, skill, mode }
      daily: { date: null, count: 0, correct: 0 },
      streak: { count: 0, lastDay: null },
      history: [],                     // [{ t, rw, math, total }] estimate after each answer
      mocks: [],                       // [{ at, section, correct, total, est }]
      premium: { active: false, code: null, since: null },
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
    out.daily = Object.assign({}, base.daily, saved.daily || {});
    out.streak = Object.assign({}, base.streak, saved.streak || {});
    out.premium = Object.assign({}, base.premium, saved.premium || {});
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  /* ----------------------------- dates ------------------------------ */

  function todayKey(d) {
    const t = d || new Date();
    return t.getFullYear() + '-' +
      String(t.getMonth() + 1).padStart(2, '0') + '-' +
      String(t.getDate()).padStart(2, '0');
  }

  function isYesterday(dayKey) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return dayKey === todayKey(y);
  }

  /* Reset the daily counter when the local day rolls over. */
  function touchDaily() {
    const s = load(), today = todayKey();
    if (s.daily.date !== today) s.daily = { date: today, count: 0, correct: 0 };
    return s.daily;
  }

  /* Record one answered question; keeps daily count, streak, seen map and
   * the score-estimate history in sync. */
  function recordAnswer(q, correct, mode) {
    const s = load();
    const daily = touchDaily();
    daily.count++;
    if (correct) daily.correct++;
    if (s.streak.lastDay !== daily.date) {
      s.streak.count = isYesterday(s.streak.lastDay) ? s.streak.count + 1 : 1;
      s.streak.lastDay = daily.date;
    }
    s.seen[q.id] = {
      correct: !!correct, at: Date.now(), mode: mode || 'practice',
      section: q.section, domain: q.domain, skill: q.skillDesc || q.skill || '',
    };
    if (s.profile) {
      const est = SMAdaptive.estimateScores(s.profile);
      s.history.push({ t: Date.now(), rw: est.rw, math: est.math, total: est.total });
      if (s.history.length > 500) s.history.splice(0, s.history.length - 500);
    }
    save();
  }

  /* Wipe progress but keep settings + premium (Settings → reset progress). */
  function resetProgress() {
    const s = load();
    const keep = { settings: s.settings, premium: s.premium };
    state = Object.assign(defaults(), keep);
    state.settings.onboarded = false;
    save();
  }

  function reset() {
    state = defaults();
    save();
  }

  return { load, save, reset, resetProgress, todayKey, touchDaily, recordAnswer, KEY };
})();
