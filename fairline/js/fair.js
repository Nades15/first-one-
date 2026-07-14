/* Fairline — the fair line itself. Pure math, no IO, fully unit-testable.
 *
 * Model: over horizons of minutes-to-hours crypto log returns are treated as
 * driftless Brownian motion, so with spot S, strike K, per-√second vol σ and
 * τ seconds to resolution:
 *
 *     P(S_τ > K) = Φ( ln(S/K) / (σ·√τ) )
 *
 * σ comes from an EWMA of 1-second log returns (createVolEstimator). This is
 * deliberately the simplest defensible model — the point of paper mode is to
 * measure how wrong it is (see the calibration chart), not to assume it. */
'use strict';

/* Standard normal CDF: Φ(x) = ½(1 + erf(x/√2)), with erf from the
 * Abramowitz–Stegun 7.1.26 approximation (|error| < 1.5e-7 — far below a 1¢
 * price grid). */
function normCdf(x) {
  if (!isFinite(x)) return x > 0 ? 1 : 0;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + (x < 0 ? -erf : erf));
}

/* P(spot > strike after tauSec), given per-√second vol. Degenerate inputs
 * collapse to the deterministic answer. */
function probAbove(spot, strike, sigmaPerSqrtSec, tauSec) {
  if (!(spot > 0) || !(strike > 0)) return NaN;
  const scale = sigmaPerSqrtSec * Math.sqrt(Math.max(0, tauSec));
  if (!(scale > 0)) return spot > strike ? 1 : 0;
  return normCdf(Math.log(spot / strike) / scale);
}

/* P(floor < spot ≤ cap after tauSec). Either bound may be missing (null):
 * a floor-only market is probAbove, a cap-only market its complement. */
function probBetween(spot, floor, cap, sigmaPerSqrtSec, tauSec) {
  const above = k => probAbove(spot, k, sigmaPerSqrtSec, tauSec);
  if (floor != null && cap != null) return above(floor) - above(cap);
  if (floor != null) return above(floor);
  if (cap != null) return 1 - above(cap);
  return NaN;
}

/* EWMA realized-vol estimator. Feed it (price, t) as often as you like; it
 * folds one log return per sampleMs boundary so a burst of trades and a
 * quiet stretch weigh the same. sigmaPerSqrtSec() is √variance normalized to
 * a 1-second horizon, ready for probAbove. */
function createVolEstimator(opts) {
  const sampleMs = (opts && opts.sampleMs) || 1000;
  const halfLifeMs = (opts && opts.halfLifeMs) || 10 * 60e3;
  const minSamples = (opts && opts.minSamples) || 60;
  const lambda = Math.pow(0.5, sampleMs / halfLifeMs);   // per-sample decay

  let lastPrice = 0, lastSampleT = -Infinity;
  let variance = 0;                                      // EWMA of r² per sample
  let samples = 0;

  function note(price, t) {
    if (!(price > 0)) return;
    if (t - lastSampleT < sampleMs) { lastPrice = price; return; }
    if (lastPrice > 0) {
      const r = Math.log(price / lastPrice);
      variance = samples === 0 ? r * r : lambda * variance + (1 - lambda) * r * r;
      samples++;
    }
    lastPrice = price;
    lastSampleT = t;
  }

  function sigmaPerSqrtSec() {
    if (samples < minSamples) return null;               // not warmed up yet
    return Math.sqrt(variance / (sampleMs / 1000));
  }

  return {
    note, sigmaPerSqrtSec,
    get samples() { return samples; },
    get warm() { return samples >= minSamples; },
    get price() { return lastPrice; },
  };
}

module.exports = { normCdf, probAbove, probBetween, createVolEstimator };
