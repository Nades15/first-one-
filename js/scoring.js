/* Lumen — score engine: baseline mapping, adaptive difficulty, weekly recalibration. */
window.Scoring = (function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  /* Map a 0..1 accuracy proportion onto the familiar 100/15 scale (bounded). */
  function proportionToIndex(p) {
    return clamp(Math.round(100 + (p - 0.5) * 70), 65, 140);
  }

  /* Grade the baseline cognitive test: difficulty-weighted accuracy → IQ estimate. */
  function gradeBaselineIQ(answers) {
    let earned = 0, total = 0;
    window.DATA.baselineIQ.forEach((item, i) => {
      total += item.w;
      if (answers[i] === item.answer) earned += item.w;
    });
    return proportionToIndex(earned / total);
  }

  /* Grade the baseline EQ mini-assessment: points earned / points possible → EQ index. */
  function gradeBaselineEQ(pointsEarned) {
    const max = window.DATA.baselineEQ.length * 2;
    return proportionToIndex(pointsEarned / max);
  }

  /* Adaptive difficulty: strong performance nudges a domain up, weak nudges it down. */
  function adaptDifficulty(state, domain, score) {
    const d = state.difficulty;
    if (score >= 75) d[domain] = clamp(d[domain] + 1, 1, 5);
    else if (score < 40) d[domain] = clamp(d[domain] - 1, 1, 5);
  }

  /*
   * Weekly recalibration. Performance is normalized 0-100 per activity; the
   * expected level is ~62 (a solid-but-human week). The gap maps to a bounded
   * IQ/EQ shift of -4..+5, scaled by how many days the user actually showed up
   * (full effect from 5 active days). Consistency matters as much as brilliance.
   */
  function finalizeWeek(state) {
    const dayEntries = Object.entries(state.days);
    const activeDays = dayEntries.filter(([, d]) =>
      Object.keys(d.games || {}).length || d.eqScore != null || d.journal
    );
    if (!activeDays.length) return null;

    const gameScores = [];
    const eqScores = [];
    const journalIQ = [];
    const journalEQ = [];
    const domainScores = {};

    activeDays.forEach(([, d]) => {
      Object.entries(d.games || {}).forEach(([id, rec]) => {
        gameScores.push(rec.score);
        (domainScores[rec.domain] = domainScores[rec.domain] || []).push(rec.score);
      });
      if (d.eqScore != null) eqScores.push(d.eqScore);
      if (d.journal) {
        journalIQ.push(d.journal.iqComponent);
        journalEQ.push(d.journal.eqComponent);
      }
    });

    const gAvg = mean(gameScores);
    const jIQ = mean(journalIQ);
    const jEQ = mean(journalEQ);
    const eAvg = mean(eqScores);

    // Cognitive performance: games 80%, journal richness 20% (when present).
    let iqPerf = gAvg;
    if (gAvg != null && jIQ != null) iqPerf = gAvg * 0.8 + jIQ * 0.2;
    else if (gAvg == null) iqPerf = jIQ;

    // Emotional performance: scenarios 70%, journal emotional depth 30%.
    let eqPerf = eAvg;
    if (eAvg != null && jEQ != null) eqPerf = eAvg * 0.7 + jEQ * 0.3;
    else if (eAvg == null) eqPerf = jEQ;

    const participation = Math.min(1, activeDays.length / 5);
    const dIQ = iqPerf == null ? 0 : clamp(Math.round(((iqPerf - 62) / 8) * participation), -4, 5);
    const dEQ = eqPerf == null ? 0 : clamp(Math.round(((eqPerf - 60) / 8) * participation), -4, 5);

    const recap = {
      weekStart: state.weekStart,
      finalizedOn: window.Store.todayISO(),
      activeDays: activeDays.length,
      iqBefore: state.iq, iqAfter: clamp(state.iq + dIQ, 55, 160), dIQ,
      eqBefore: state.eq, eqAfter: clamp(state.eq + dEQ, 55, 160), dEQ,
      iqPerf: iqPerf == null ? null : Math.round(iqPerf),
      eqPerf: eqPerf == null ? null : Math.round(eqPerf),
      domains: Object.fromEntries(Object.entries(domainScores).map(([k, v]) => [k, Math.round(mean(v))])),
    };

    state.iq = recap.iqAfter;
    state.eq = recap.eqAfter;
    state.history.push(recap);
    state.scoreHistory.push({ date: recap.finalizedOn, iq: state.iq, eq: state.eq });
    return recap;
  }

  /* Roll the week over if the calendar has moved past the stored week. */
  function rolloverIfNeeded(state) {
    if (!state.profile) return;
    const currentWeek = window.Store.mondayOf(window.Store.todayISO());
    if (state.weekStart && state.weekStart !== currentWeek) {
      const recap = finalizeWeek(state);
      if (recap) state.pendingRecap = recap;
      state.days = {};
      state.weekStart = currentWeek;
      window.Store.save();
    } else if (!state.weekStart) {
      state.weekStart = currentWeek;
      window.Store.save();
    }
  }

  /* Streak bookkeeping — a day counts when the full circuit is complete. */
  function markDayComplete(state) {
    const t = window.Store.todayISO();
    if (state.lastCompleteDay === t) return;
    const yesterday = new Date(t + 'T12:00:00');
    yesterday.setDate(yesterday.getDate() - 1);
    const yISO = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
    state.streak = state.lastCompleteDay === yISO ? state.streak + 1 : 1;
    state.lastCompleteDay = t;
  }

  return { proportionToIndex, gradeBaselineIQ, gradeBaselineEQ, adaptDifficulty, finalizeWeek, rolloverIfNeeded, markDayComplete, clamp, mean };
})();
