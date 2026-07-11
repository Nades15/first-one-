/* Summit — normalize College Board question-bank payloads into one schema,
 * plus SPR (student-produced response) answer grading. No DOM, no fetch —
 * shared by bank.js (browser), tools/fetch-bank.mjs (node), and tests. */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SMQnorm = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LETTERS = 'ABCDEFGH';

  /* One row of the get-questions list → compact metadata. Items that only
   * have an `ibn` (paper-test disclosures behind a different endpoint) keep
   * it so callers can count what they skipped. */
  function normalizeMeta(m, section) {
    return {
      id: m.external_id || m.uId || m.questionId,
      section,
      domain: m.primary_class_cd,
      skill: m.skill_cd,
      skillDesc: m.skill_desc,
      difficulty: m.difficulty,
      band: Number(m.score_band_range_cd) || null,
      external: m.external_id || null,
      ibn: m.ibn || null,
    };
  }

  /* get-question response + its metadata → a full question.
   * mcq: options get display letters; the correct letters come from
   * correct_answer when present, else from matching `keys` (option uuids).
   * spr: correct is the list of accepted answer strings. */
  function normalizeItem(meta, raw) {
    const type = String(raw.type || 'mcq').toLowerCase();
    const options = (raw.answerOptions || []).map((o, i) => ({
      letter: LETTERS[i],
      html: String(o.content == null ? '' : o.content),
      key: o.id,
    }));

    let correct = Array.isArray(raw.correct_answer) ? raw.correct_answer.slice() : [];
    if (type === 'mcq' && !correct.length && Array.isArray(raw.keys)) {
      correct = raw.keys
        .map(k => (options.find(o => o.key === k) || {}).letter)
        .filter(Boolean);
    }
    if (type !== 'mcq' && !correct.length && Array.isArray(raw.keys)) {
      correct = raw.keys.map(String);
    }

    return {
      id: meta.id,
      section: meta.section,
      domain: meta.domain,
      skill: meta.skill,
      skillDesc: meta.skillDesc,
      difficulty: meta.difficulty,
      band: meta.band,
      type,
      stimulus: String(raw.stimulus == null ? '' : raw.stimulus),
      stem: String(raw.stem == null ? '' : raw.stem),
      options: options.map(o => ({ letter: o.letter, html: o.html })),
      correct,
      rationale: String(raw.rationale == null ? '' : raw.rationale),
    };
  }

  /* "3/4", "0.75", ".75", "1,200" → a number; null when not numeric. */
  function parseNumeric(s) {
    const t = String(s == null ? '' : s).trim().replace(/,/g, '');
    if (!t) return null;
    const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (frac) {
      const d = Number(frac[2]);
      return d === 0 ? null : Number(frac[1]) / d;
    }
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  /* Grade a grid-in: exact (case/space-insensitive) string match against any
   * accepted answer, or numeric equivalence so 0.75 matches "3/4". */
  function matchesSpr(input, accepted) {
    const inStr = String(input == null ? '' : input).trim().toLowerCase();
    if (!inStr) return false;
    const inNum = parseNumeric(inStr);
    for (const a of accepted || []) {
      const aStr = String(a).trim().toLowerCase();
      if (inStr === aStr) return true;
      const aNum = parseNumeric(aStr);
      if (inNum != null && aNum != null &&
          Math.abs(inNum - aNum) <= 1e-6 * Math.max(1, Math.abs(aNum))) return true;
    }
    return false;
  }

  return { normalizeMeta, normalizeItem, parseNumeric, matchesSpr, LETTERS };
});
