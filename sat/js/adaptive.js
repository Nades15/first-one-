/* Summit — pure adaptive engine: Elo-style ability tracking, question
 * selection, mock drawing, and score estimation. No DOM, no fetch — runs in
 * node for tests (sat/test/) and in the browser as window.SMAdaptive.
 *
 * Everything lives on one 0–100 rating scale. A 200–800 section score maps
 * linearly onto it (500 → 50). Each question gets a difficulty rating from
 * College Board's own tags — score_band_range_cd (1–7) when present, else
 * the E/M/H difficulty letter — plus a small deterministic jitter so a band
 * isn't a single point. After every answer the ability moves toward the
 * result by K·(actual − expected), with K decaying as evidence accumulates:
 * fast calibration in the first session, stability later. */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SMAdaptive = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    SCALE: 20,             // logistic scale: 20 rating pts ≈ 91%/9% odds
    K_MAX: 16,
    K_MIN: 4,
    K_HALF_LIFE: 12,       // answers until K has decayed halfway to K_MIN
    TARGET_OFFSET: -7,     // aim ~7 pts under ability ≈ 70% expected success
    BAND_RATING: { 1: 18, 2: 29, 3: 40, 4: 51, 5: 62, 6: 73, 7: 84 },
    DIFF_RATING: { E: 32, M: 55, H: 78 },
    JITTER: 5,             // deterministic per-question spread within a band
    MOCK_K_FACTOR: 0.5,    // mock answers move ratings half as much
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const opt = (opts, key) => (opts && opts[key] != null ? opts[key] : DEFAULTS[key]);

  /* ------------------------- score <-> ability ------------------------- */

  function scoreToAbility(score) {
    const s = Number(score);
    return (clamp(isFinite(s) && s > 0 ? s : 500, 200, 800) - 200) / 6;
  }

  function abilityToScore(ability) {
    return clamp(Math.round((200 + 6 * ability) / 10) * 10, 200, 800);
  }

  /* ------------------------- question difficulty ------------------------ */

  function hashId(id) {
    let h = 5381;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h;
  }

  function difficultyRating(q, opts) {
    const bands = opt(opts, 'BAND_RATING'), letters = opt(opts, 'DIFF_RATING');
    const jit = opt(opts, 'JITTER');
    const base = bands[q.band] != null ? bands[q.band]
      : letters[q.difficulty] != null ? letters[q.difficulty] : 55;
    const jitter = (hashId(q.id) % (2 * jit + 1)) - jit;
    return clamp(base + jitter, 5, 95);
  }

  /* --------------------------- rating updates --------------------------- */

  function expected(ability, difficulty, opts) {
    return 1 / (1 + Math.pow(10, (difficulty - ability) / opt(opts, 'SCALE')));
  }

  function kFactor(nAnswered, opts) {
    const kMax = opt(opts, 'K_MAX'), kMin = opt(opts, 'K_MIN'), hl = opt(opts, 'K_HALF_LIFE');
    return kMin + (kMax - kMin) * hl / (hl + nAnswered);
  }

  /*
   * profile = {
   *   ability: { rw, math },        // section ratings 0–100
   *   domains: { [code]: rating },  // seeded from the section on first touch
   *   domainN: { [code]: count },
   *   answered: { rw, math },       // drives K decay
   * }
   */
  function initProfile(scores) {
    scores = scores || {};
    return {
      ability: { rw: scoreToAbility(scores.rw), math: scoreToAbility(scores.math) },
      domains: {},
      domainN: {},
      answered: { rw: 0, math: 0 },
    };
  }

  function domainAbility(profile, q) {
    return profile.domains[q.domain] != null ? profile.domains[q.domain]
      : profile.ability[q.section];
  }

  /* Mutates profile; returns what happened so the UI can narrate it.
   * opts.kFactor scales K (mocks pass MOCK_K_FACTOR). */
  function applyAnswer(profile, q, correct, opts) {
    const diff = difficultyRating(q, opts);
    const scale = (opts && opts.kFactor) || 1;
    const k = kFactor(profile.answered[q.section], opts) * scale;
    const act = correct ? 1 : 0;

    const exp = expected(profile.ability[q.section], diff, opts);
    const delta = k * (act - exp);
    profile.ability[q.section] = clamp(profile.ability[q.section] + delta, 0, 100);

    const dom = domainAbility(profile, q);
    const domDelta = k * (act - expected(dom, diff, opts));
    profile.domains[q.domain] = clamp(dom + domDelta, 0, 100);
    profile.domainN[q.domain] = (profile.domainN[q.domain] || 0) + 1;

    profile.answered[q.section]++;
    return { expected: exp, delta, difficulty: diff };
  }

  function estimateScores(profile) {
    const rw = abilityToScore(profile.ability.rw);
    const math = abilityToScore(profile.ability.math);
    return { rw, math, total: rw + math };
  }

  /* Weakest domain with enough evidence to be worth naming. */
  function weakestDomain(profile, minAttempts) {
    const min = minAttempts == null ? 3 : minAttempts;
    let worst = null;
    for (const code of Object.keys(profile.domains)) {
      if ((profile.domainN[code] || 0) < min) continue;
      if (!worst || profile.domains[code] < worst.rating) {
        worst = { domain: code, rating: profile.domains[code] };
      }
    }
    return worst;
  }

  /* --------------------------- question choice -------------------------- */

  /*
   * Pick the next practice question from a pool of UNSEEN questions (the
   * caller filters out seen ids). Scores every candidate by distance from
   * the ~70%-success sweet spot for its section, pulled toward weak domains
   * and the lesser-practised section, with a little rng so runs differ.
   */
  function selectQuestion(pool, profile, opts) {
    if (!pool || !pool.length) return null;
    const rng = (opts && opts.rng) || Math.random;
    const off = opt(opts, 'TARGET_OFFSET');
    const mixed = pool.some(q => q.section === 'rw') && pool.some(q => q.section === 'math');
    const lesser = profile.answered.rw <= profile.answered.math ? 'rw' : 'math';

    let best = null, bestScore = Infinity;
    for (const q of pool) {
      const target = profile.ability[q.section] + off;
      const weakness = Math.max(0, profile.ability[q.section] - domainAbility(profile, q)) * 0.6;
      const balance = mixed && q.section === lesser ? 3 : 0;
      const score = Math.abs(difficultyRating(q, opts) - target) - weakness - balance + rng() * 4;
      if (score < bestScore) { bestScore = score; best = q; }
    }
    return best;
  }

  /*
   * Draw n questions for a timed mock: round-robin across difficulty bands
   * (shuffled within each) so the module spans easy → hard like the real
   * test, rather than clustering at the student's level.
   */
  function mockDraw(pool, n, rng) {
    rng = rng || Math.random;
    const byBand = new Map();
    for (const q of pool) {
      const band = q.band != null ? q.band : { E: 2, M: 4, H: 6 }[q.difficulty] || 4;
      if (!byBand.has(band)) byBand.set(band, []);
      byBand.get(band).push(q);
    }
    const groups = [...byBand.keys()].sort((a, b) => a - b).map(b => {
      const g = byBand.get(b).slice();
      for (let i = g.length - 1; i > 0; i--) {           // Fisher–Yates
        const j = Math.floor(rng() * (i + 1));
        [g[i], g[j]] = [g[j], g[i]];
      }
      return g;
    });
    const out = [];
    for (let round = 0; out.length < n; round++) {
      let took = false;
      for (const g of groups) {
        if (round < g.length && out.length < n) { out.push(g[round]); took = true; }
      }
      if (!took) break;                                  // pool exhausted
    }
    /* Present roughly easiest-first, like the real module. */
    out.sort((a, b) => difficultyRating(a) - difficultyRating(b));
    return out;
  }

  return {
    DEFAULTS, hashId, clamp,
    scoreToAbility, abilityToScore, difficultyRating, expected, kFactor,
    initProfile, domainAbility, applyAnswer, estimateScores, weakestDomain,
    selectQuestion, mockDraw,
  };
});
