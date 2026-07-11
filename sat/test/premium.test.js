/* Summit freemium tests — run with: node --test sat/test */
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../js/premium.js');

const SALT = 'summit-v1';

test('makeCode/validateCode round-trip, case- and spacing-insensitive', () => {
  const code = P.makeCode('TRIAL', SALT);
  assert.match(code, /^SUMMIT-TRIAL-[0-9A-Z]{4}$/);
  assert.ok(P.validateCode(code, SALT));
  assert.ok(P.validateCode(code.toLowerCase(), SALT));
  assert.ok(P.validateCode('  ' + code.replace(/-/g, ' - ') + '  ', SALT));
});

test('tampered, truncated, or wrong-salt codes are rejected', () => {
  const code = P.makeCode('TRIAL', SALT);
  const [pre, pay, chk] = code.split('-');
  assert.equal(P.validateCode(pre + '-' + pay + '-' + (chk === '0000' ? '0001' : '0000'), SALT), false);
  assert.equal(P.validateCode(pre + '-HACK-' + chk, SALT), false);
  assert.equal(P.validateCode(code, 'other-salt'), false);
  assert.equal(P.validateCode('SUMMIT-TRIAL', SALT), false);
  assert.equal(P.validateCode('', SALT), false);
  assert.equal(P.validateCode(null, SALT), false);
});

test('makeCode normalizes payloads and refuses short ones', () => {
  assert.equal(P.makeCode('ab', SALT), null);
  const code = P.makeCode('beta tester #1', SALT);
  assert.ok(code.includes('-BETATESTER1-'));
  assert.ok(P.validateCode(code, SALT));
});

test('capInfo enforces the free daily cap and lifts it for premium', () => {
  assert.deepEqual(P.capInfo(0, false, 10), { capped: false, remaining: 10 });
  assert.deepEqual(P.capInfo(9, false, 10), { capped: false, remaining: 1 });
  assert.deepEqual(P.capInfo(10, false, 10), { capped: true, remaining: 0 });
  assert.deepEqual(P.capInfo(25, false, 10), { capped: true, remaining: 0 });
  assert.equal(P.capInfo(500, true, 10).capped, false);
});
