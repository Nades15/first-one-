/* Pulse — simulator, trade, and smart-exit defaults. Every threshold the
 * exit engine uses lives here (and can be overridden in Settings), so the
 * engine itself stays a pure function of its inputs. */
window.SXConfig = (function () {
  'use strict';

  const TICK_MS = 250;          // sim resolution: 16 ticks in a 4s hold, 40 in a 10s one
  const SOL_USD = 150;          // display conversion only
  const HISTORY_CAP = 200;      // trade records kept

  const TRADE = {
    buySizeSol: 0.5,            // paper entry size, in SOL
    entryDelayMs: 1000,         // let the sim warm up before buying
  };

  /* The smart-exit engine. The hold timer is the DEFAULT exit, not the only
   * one: strong momentum extends it (up to maxHoldMs), weak momentum cuts it,
   * and emergencies fire immediately regardless of everything else. */
  const EXIT = {
    baseHoldMs: 4000,           // default hold before the timer exit
    maxHoldMs: 10000,           // extensions never push the deadline past this
    extendStepMs: 1500,         // each strong-momentum extension adds this
    minEvalMs: 750,             // grace after entry before weak-momentum exits fire

    /* momentum: price velocity. Thresholds sit ~2 sigma outside the EMA noise
     * of balanced flow, so chop doesn't trip them but real moves do. */
    velEmaTicks: 8,             // EMA span for per-second log returns (8 x 250ms = 2s)
    strongVelPctPerSec: 2.0,    // %/s and above counts toward "strong"
    weakVelPctPerSec: -1.5,     // %/s and below is "weak" on its own

    /* momentum: buy/sell flow */
    txWindowMs: 3000,           // rolling window for the buy/sell volume ratio
    strongBuyRatio: 0.62,       // buys as share of quote volume
    weakBuyRatio: 0.42,
    pressureRiseMin: -0.15,     // recent-half minus prior-half ratio; above = pressure holding
                                // (loose: a saturated 0.9 ratio jitters ±0.1 without meaning decay)
    pressureFallMax: -0.08,     // below = buying pressure clearly decreasing

    /* volume acceleration */
    volBucketMs: 1000,          // per-second quote-volume buckets
    volRecentBuckets: 2,
    volBaseBuckets: 4,
    strongVolAccel: 1.2,        // recent/baseline volume ratio
    weakVolAccel: 0.4,

    /* liquidity protection (discretionary sells only — emergencies ignore it) */
    maxImpactPct: 8,            // defer a timer/weakness sell above this expected impact
    impactDeferMaxMs: 1500,     // ...but never defer longer than this
    splitImpactPct: 15,         // at forced sell, split the order above this impact
    impactSplitParts: 2,

    /* emergency: liquidity pull */
    liqPullPct: 30,             // % of quote reserve gone within the window
    liqPullWindowMs: 2000,

    /* emergency: whale dump */
    whaleHolderPct: 4,          // holders at/above this % of supply are whales (dev always is)
    whaleSellPortion: 0.35,     // portion of their holding sold within the window
    whaleWindowMs: 2500,
    whaleSellQuotePct: 3,       // or any single sell this large vs pool quote

    /* emergency: sell restriction (honeypot) */
    honeypotMinTx: 6,           // trades in the gap window with zero sells...
    honeypotGapMs: 2500,        // ...where sells previously existed

    /* emergency: contract risk — any of these flags flipping true */
    riskFlags: ['mintEnabled', 'lpUnlocked', 'blacklistRisk'],
  };

  const SIM = {
    supply: 1e9,                // token base supply
    initQuoteSol: 100,          // starting SOL side of the pool
    poolShare: 0.5,             // share of supply seeded into the pool
    minTradeSol: 0.02,          // retail trade floor
    maxTradeMult: 40,           // heavy tail: quote = min * maxMult^rng()
    retailWallets: 60,
  };

  /* Deterministic verification mode (?mock=1): pinned seed + scenario. */
  const MOCK = { seed: 42, scenario: 'rugPull' };

  const SPEEDS = [
    { mult: 1, label: '1×' },
    { mult: 2, label: '2×' },
    { mult: 4, label: '4×' },
  ];

  return { TICK_MS, SOL_USD, HISTORY_CAP, TRADE, EXIT, SIM, MOCK, SPEEDS };
})();
