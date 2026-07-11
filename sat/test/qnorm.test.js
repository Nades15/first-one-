/* Summit question-normalizer tests — run with: node --test sat/test */
const { test } = require('node:test');
const assert = require('node:assert');
const Q = require('../js/qnorm.js');

/* Shapes mirror College Board's qbank API responses. */
const META_ROW = {
  questionId: 'f2b32c5e', external_id: 'a1b2c3d4-0000-1111-2222-333344445555',
  uId: 'u-1', ibn: null, primary_class_cd: 'H', skill_cd: 'H.C.',
  skill_desc: 'Linear equations in two variables', difficulty: 'M',
  score_band_range_cd: '5',
};

test('normalizeMeta keeps the fields the app needs', () => {
  const m = Q.normalizeMeta(META_ROW, 'math');
  assert.equal(m.id, META_ROW.external_id);
  assert.equal(m.section, 'math');
  assert.equal(m.domain, 'H');
  assert.equal(m.band, 5);
  assert.equal(m.difficulty, 'M');
  assert.equal(m.ibn, null);
});

test('normalizeMeta falls back to uId and surfaces ibn-only items', () => {
  const m = Q.normalizeMeta({ uId: 'u-9', ibn: 'SAT-123', difficulty: 'E' }, 'rw');
  assert.equal(m.id, 'u-9');
  assert.equal(m.external, null);
  assert.equal(m.ibn, 'SAT-123');
  assert.equal(m.band, null);
});

test('normalizeItem letters mcq options and reads correct_answer', () => {
  const meta = Q.normalizeMeta(META_ROW, 'math');
  const item = Q.normalizeItem(meta, {
    type: 'mcq', stem: '<p>2x = 10. x = ?</p>',
    answerOptions: [{ id: 'k1', content: '<p>3</p>' }, { id: 'k2', content: '<p>5</p>' }],
    correct_answer: ['B'], rationale: '<p>Divide by 2.</p>',
  });
  assert.deepEqual(item.options, [
    { letter: 'A', html: '<p>3</p>' }, { letter: 'B', html: '<p>5</p>' }]);
  assert.deepEqual(item.correct, ['B']);
  assert.equal(item.stimulus, '');
  assert.equal(item.band, 5);
});

test('normalizeItem derives mcq letters from keys when correct_answer is missing', () => {
  const item = Q.normalizeItem(Q.normalizeMeta(META_ROW, 'math'), {
    type: 'mcq',
    answerOptions: [{ id: 'k1', content: 'no' }, { id: 'k2', content: 'yes' }],
    keys: ['k2'],
  });
  assert.deepEqual(item.correct, ['B']);
});

test('normalizeItem keeps spr accepted answers from correct_answer or keys', () => {
  const meta = Q.normalizeMeta(META_ROW, 'math');
  assert.deepEqual(
    Q.normalizeItem(meta, { type: 'spr', stem: 's', correct_answer: ['3/4', '.75'] }).correct,
    ['3/4', '.75']);
  assert.deepEqual(
    Q.normalizeItem(meta, { type: 'spr', stem: 's', keys: [14] }).correct, ['14']);
});

test('matchesSpr accepts string matches and numeric equivalents', () => {
  assert.ok(Q.matchesSpr('3/4', ['3/4', '.75']));
  assert.ok(Q.matchesSpr('0.75', ['3/4']));        // decimal vs fraction
  assert.ok(Q.matchesSpr(' .75 ', ['0.75']));
  assert.ok(Q.matchesSpr('1,200', ['1200']));
  assert.ok(Q.matchesSpr('-1/2', ['-0.5']));
  assert.equal(Q.matchesSpr('0.76', ['3/4']), false);
  assert.equal(Q.matchesSpr('', ['0']), false);
  assert.equal(Q.matchesSpr('x', ['10']), false);
});

test('parseNumeric handles fractions, commas, and rejects junk', () => {
  assert.equal(Q.parseNumeric('3/4'), 0.75);
  assert.equal(Q.parseNumeric('1,234.5'), 1234.5);
  assert.equal(Q.parseNumeric('5/0'), null);
  assert.equal(Q.parseNumeric('abc'), null);
  assert.equal(Q.parseNumeric(''), null);
});
