/* Fair-value math — node --test fairline/test/fair.test.js */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normCdf, probAbove, probBetween, createVolEstimator } = require('../js/fair.js');

test('normCdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.9750) < 3e-4);
  assert.ok(Math.abs(normCdf(-1.96) - 0.0250) < 3e-4);
  assert.ok(Math.abs(normCdf(1) - 0.8413) < 3e-4);
  assert.ok(Math.abs(normCdf(2) + normCdf(-2) - 1) < 1e-7);   // symmetry
  assert.equal(normCdf(Infinity), 1);
  assert.equal(normCdf(-Infinity), 0);
});

test('probAbove: at-the-money is a coin flip', () => {
  assert.ok(Math.abs(probAbove(100, 100, 0.001, 3600) - 0.5) < 1e-9);
});

test('probAbove: d=1 case reproduces Φ(1)', () => {
  // ln(S/K) = sigma·√tau  ⇒  d = 1
  const sigma = Math.log(110 / 100) / Math.sqrt(3600);
  assert.ok(Math.abs(probAbove(110, 100, sigma, 3600) - 0.8413) < 5e-4);
});

test('probAbove: zero time or zero vol collapses to a step', () => {
  assert.equal(probAbove(101, 100, 0.001, 0), 1);
  assert.equal(probAbove(99, 100, 0.001, 0), 0);
  assert.equal(probAbove(101, 100, 0, 3600), 1);
});

test('probAbove is monotonic in spot and returns NaN on garbage', () => {
  const p1 = probAbove(99, 100, 0.001, 600);
  const p2 = probAbove(100, 100, 0.001, 600);
  const p3 = probAbove(101, 100, 0.001, 600);
  assert.ok(p1 < p2 && p2 < p3);
  assert.ok(Number.isNaN(probAbove(0, 100, 0.001, 600)));
  assert.ok(Number.isNaN(probAbove(100, -1, 0.001, 600)));
});

test('probBetween: range, floor-only, cap-only all agree', () => {
  const sigma = 0.001, tau = 3600;
  const between = probBetween(100, 95, 105, sigma, tau);
  assert.ok(Math.abs(between - (probAbove(100, 95, sigma, tau) - probAbove(100, 105, sigma, tau))) < 1e-12);
  assert.equal(probBetween(100, 95, null, sigma, tau), probAbove(100, 95, sigma, tau));
  assert.ok(Math.abs(probBetween(100, null, 105, sigma, tau) - (1 - probAbove(100, 105, sigma, tau))) < 1e-12);
  assert.ok(Number.isNaN(probBetween(100, null, null, sigma, tau)));
});

test('vol estimator recovers a constant per-sample return', () => {
  const est = createVolEstimator({ sampleMs: 1000, halfLifeMs: 60e3, minSamples: 10 });
  const r = 0.001;
  let price = 100;
  for (let i = 0; i < 200; i++) {
    price *= Math.exp(i % 2 === 0 ? r : -r);   // alternate ±r, |return| constant
    est.note(price, i * 1000);
  }
  const sigma = est.sigmaPerSqrtSec();
  assert.ok(sigma != null);
  assert.ok(Math.abs(sigma - r) / r < 0.01, 'sigma ' + sigma + ' should be ~' + r);
});

test('vol estimator: not warm before minSamples, ignores sub-sample spam', () => {
  const est = createVolEstimator({ sampleMs: 1000, halfLifeMs: 60e3, minSamples: 5 });
  for (let i = 0; i < 40; i++) est.note(100 + i, i * 100);   // 40 msgs in 4s → ≤4 samples
  assert.equal(est.sigmaPerSqrtSec(), null);
  assert.ok(est.samples <= 4);
});
