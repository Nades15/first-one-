/* Summit adaptive engine tests — run with: node --test sat/test */
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../js/adaptive.js');

/* Deterministic rng for selection tests. */
const zeroRng = () => 0;

const q = (id, section, extra) => Object.assign(
  { id: String(id), section, domain: section === 'rw' ? 'INI' : 'H', difficulty: 'M', band: 4 },
  extra);

/* ------------------------- score <-> ability ------------------------- */

test('score maps linearly onto the 0-100 ability scale and back', () => {
  assert.equal(A.scoreToAbility(200), 0);
  assert.equal(A.scoreToAbility(500), 50);
  assert.equal(A.scoreToAbility(800), 100);
  assert.equal(A.abilityToScore(50), 500);
  assert.equal(A.abilityToScore(0), 200);
  assert.equal(A.abilityToScore(100), 800);
});

test('score mapping clamps and defaults out-of-range input', () => {
  assert.equal(A.scoreToAbility(1000), 100);
  assert.equal(A.scoreToAbility(-5), 50);          // nonsense -> median
  assert.equal(A.scoreToAbility(undefined), 50);
  assert.equal(A.abilityToScore(999), 800);
  assert.equal(A.abilityToScore(43.7), 460);       // rounds to 10s
});

/* --------------------------- difficulty ------------------------------ */

test('difficulty rating orders bands and letters, jitter is deterministic and bounded', () => {
  const e = A.difficultyRating(q(1, 'rw', { band: null, difficulty: 'E' }));
  const m = A.difficultyRating(q(1, 'rw', { band: null, difficulty: 'M' }));
  const h = A.difficultyRating(q(1, 'rw', { band: null, difficulty: 'H' }));
  assert.ok(e < m && m < h);

  const b1 = A.difficultyRating(q(9, 'rw', { band: 1 }));
  const b7 = A.difficultyRating(q(9, 'rw', { band: 7 }));
  assert.ok(b1 < b7);

  const r1 = A.difficultyRating(q('abc', 'math'));
  const r2 = A.difficultyRating(q('abc', 'math'));
  assert.equal(r1, r2);                            // same id -> same rating
  assert.ok(Math.abs(r1 - A.DEFAULTS.BAND_RATING[4]) <= A.DEFAULTS.JITTER);
});

/* ------------------------- expected & K ------------------------------ */

test('expected is 50% at equal ratings and rises with ability', () => {
  assert.equal(A.expected(50, 50), 0.5);
  assert.ok(A.expected(70, 50) > 0.85);
  assert.ok(A.expected(30, 50) < 0.15);
});

test('K decays with answers but never below the floor', () => {
  assert.equal(A.kFactor(0), A.DEFAULTS.K_MAX);
  assert.ok(A.kFactor(12) < A.kFactor(0));
  assert.ok(A.kFactor(200) > A.DEFAULTS.K_MIN);
  assert.ok(A.kFactor(1e6) < A.DEFAULTS.K_MIN + 0.01);
});

/* -------------------------- applyAnswer ------------------------------ */

test('correct answers raise ability, wrong answers lower it', () => {
  const p = A.initProfile({ rw: 500, math: 500 });
  const r1 = A.applyAnswer(p, q(1, 'math'), true);
  assert.ok(r1.delta > 0);
  assert.ok(p.ability.math > 50);
  const before = p.ability.math;
  const r2 = A.applyAnswer(p, q(2, 'math'), false);
  assert.ok(r2.delta < 0);
  assert.ok(p.ability.math < before);
  assert.equal(p.ability.rw, 50);                  // other section untouched
  assert.equal(p.answered.math, 2);
});

test('surprising results move the rating more than expected ones', () => {
  const pHard = A.initProfile({ math: 500 });
  const pEasy = A.initProfile({ math: 500 });
  const upHard = A.applyAnswer(pHard, q(1, 'math', { band: 7 }), true).delta;
  const upEasy = A.applyAnswer(pEasy, q(1, 'math', { band: 1 }), true).delta;
  assert.ok(upHard > upEasy);
});

test('mock kFactor halves the movement, domain ratings track separately', () => {
  const a = A.initProfile({ math: 500 });
  const b = A.initProfile({ math: 500 });
  const full = A.applyAnswer(a, q(1, 'math'), true).delta;
  const half = A.applyAnswer(b, q(1, 'math'), true, { kFactor: A.DEFAULTS.MOCK_K_FACTOR }).delta;
  assert.ok(Math.abs(half - full / 2) < 1e-9);
  assert.ok(a.domains.H > 50);
  assert.equal(a.domainN.H, 1);
});

/* ------------------------ estimate & weakest -------------------------- */

test('estimateScores rounds to 10s and totals the sections', () => {
  const p = A.initProfile({ rw: 610, math: 540 });
  const est = A.estimateScores(p);
  assert.equal(est.rw, 610);
  assert.equal(est.math, 540);
  assert.equal(est.total, 1150);
});

test('weakestDomain needs evidence and picks the lowest rating', () => {
  const p = A.initProfile({ rw: 500, math: 500 });
  assert.equal(A.weakestDomain(p), null);
  for (let i = 0; i < 3; i++) A.applyAnswer(p, q('h' + i, 'math', { domain: 'H' }), true);
  for (let i = 0; i < 3; i++) A.applyAnswer(p, q('q' + i, 'math', { domain: 'Q' }), false);
  assert.equal(A.weakestDomain(p).domain, 'Q');
  assert.equal(A.weakestDomain(p, 10), null);      // not enough attempts
});

/* -------------------------- selectQuestion ---------------------------- */

test('selectQuestion targets the ~70% zone near ability', () => {
  const p = A.initProfile({ math: 500 });          // ability 50, target 43
  const pool = [1, 3, 5, 7].map(band => q('b' + band, 'math', { band }));
  const pick = A.selectQuestion(pool, p, { rng: zeroRng });
  assert.equal(pick.band, 3);                      // band 3 = 40, closest to 43
});

test('selectQuestion prefers weak domains and returns null on empty pool', () => {
  const p = A.initProfile({ math: 500 });
  p.domains.Q = 35; p.domainN.Q = 5;               // struggling in data analysis
  const pool = [
    q('a', 'math', { domain: 'H', band: 3 }),
    q('b', 'math', { domain: 'Q', band: 3 }),
  ];
  assert.equal(A.selectQuestion(pool, p, { rng: zeroRng }).domain, 'Q');
  assert.equal(A.selectQuestion([], p), null);
  assert.equal(A.selectQuestion(null, p), null);
});

test('selectQuestion nudges toward the lesser-practised section in mixed pools', () => {
  const p = A.initProfile({ rw: 500, math: 500 });
  p.answered.math = 10;                            // rw is behind
  const pool = [q('m', 'math', { band: 3 }), q('r', 'rw', { band: 3 })];
  assert.equal(A.selectQuestion(pool, p, { rng: zeroRng }).section, 'rw');
});

/* ----------------------------- mockDraw ------------------------------- */

test('mockDraw spans bands, respects n, sorts easiest-first, survives small pools', () => {
  const pool = [];
  for (let band = 1; band <= 7; band++) {
    for (let i = 0; i < 5; i++) pool.push(q('b' + band + 'i' + i, 'math', { band }));
  }
  const drawn = A.mockDraw(pool, 14, zeroRng);
  assert.equal(drawn.length, 14);
  assert.equal(new Set(drawn.map(x => x.id)).size, 14);          // no repeats
  assert.equal(new Set(drawn.map(x => x.band)).size, 7);         // every band shows up
  const ratings = drawn.map(x => A.difficultyRating(x));
  assert.deepEqual(ratings, [...ratings].sort((a, b) => a - b)); // easiest-first
  assert.equal(A.mockDraw(pool.slice(0, 3), 22, zeroRng).length, 3); // pool exhausted
});
