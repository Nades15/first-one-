/* MFFU Trade Copilot — plan presets & instrument specs. */
window.TBConfig = (function () {
  'use strict';

  /*
   * Plan presets for MyFundedFutures 25k evaluations.
   * Values reflect published rules as of mid-2026 — MFFU changes plans
   * periodically, so every number is editable in Settings. Always verify
   * against your own MFFU dashboard.
   *
   * drawdownMode 'eod-trailing': the Max Loss Limit (MLL) trails your
   * END-OF-DAY balance upward, never intraday, and locks permanently once
   * it reaches startBalance + lockBuffer. Treat the MLL as a hard line:
   * if your balance touches it, the account is breached.
   */
  const PLANS = {
    rapid25k: {
      id: 'rapid25k',
      label: 'Rapid 25k',
      startBalance: 25000,
      profitTarget: 1500,
      maxLoss: 1000,
      drawdownMode: 'eod-trailing',
      lockBuffer: 100,            // MLL locks at $25,100
      consistencyPct: 0,          // no consistency rule
      dailyLossLimit: 0,          // none
      maxMinis: 3,
      maxMicros: 30,
      minTradingDays: 1,
      activityRule: 'Place at least one trade every 7 calendar days.',
      notes: 'No consistency rule, no daily loss limit. MLL locks at $25,100.',
    },
    builder25k: {
      id: 'builder25k',
      label: 'Builder 25k',
      startBalance: 25000,
      profitTarget: 3000,
      maxLoss: 1500,              // $2,000 variant exists — edit in Settings
      drawdownMode: 'eod-trailing',
      lockBuffer: 100,
      consistencyPct: 0,
      dailyLossLimit: 0,
      maxMinis: 3,
      maxMicros: 30,
      minTradingDays: 1,
      activityRule: 'Stay active; check your dashboard for the current activity rule.',
      notes: 'Higher $3,000 target. Your Max Loss is $1,500 or $2,000 depending on the add-on you bought — set it in Settings.',
    },
    starter25k: {
      id: 'starter25k',
      label: 'Starter / Flex 25k (legacy)',
      startBalance: 25000,
      profitTarget: 1500,
      maxLoss: 1000,
      drawdownMode: 'eod-trailing',
      lockBuffer: 100,
      consistencyPct: 50,         // best day ≤ 50% of total profit during eval
      dailyLossLimit: 0,
      maxMinis: 3,
      maxMicros: 30,
      minTradingDays: 2,
      activityRule: 'Place at least one trade every 7 calendar days.',
      notes: '50% consistency rule applies during the evaluation: no single day may account for more than half of your total profit when you finish.',
    },
  };

  /*
   * Futures contract specs: tick size (price units) and dollar value per tick.
   * minisEquivalent: how many of this contract equal one mini for MFFU
   * contract-limit purposes (micros count 10:1).
   */
  const INSTRUMENTS = {
    ES:  { label: 'ES — E-mini S&P 500',        tickSize: 0.25, tickValue: 12.50, minisEquivalent: 1 },
    MES: { label: 'MES — Micro S&P 500',        tickSize: 0.25, tickValue: 1.25,  minisEquivalent: 0.1 },
    NQ:  { label: 'NQ — E-mini Nasdaq-100',     tickSize: 0.25, tickValue: 5.00,  minisEquivalent: 1 },
    MNQ: { label: 'MNQ — Micro Nasdaq-100',     tickSize: 0.25, tickValue: 0.50,  minisEquivalent: 0.1 },
    YM:  { label: 'YM — E-mini Dow',            tickSize: 1.00, tickValue: 5.00,  minisEquivalent: 1 },
    MYM: { label: 'MYM — Micro Dow',            tickSize: 1.00, tickValue: 0.50,  minisEquivalent: 0.1 },
    RTY: { label: 'RTY — E-mini Russell 2000',  tickSize: 0.10, tickValue: 5.00,  minisEquivalent: 1 },
    M2K: { label: 'M2K — Micro Russell 2000',   tickSize: 0.10, tickValue: 0.50,  minisEquivalent: 0.1 },
    GC:  { label: 'GC — Gold',                  tickSize: 0.10, tickValue: 10.00, minisEquivalent: 1 },
    MGC: { label: 'MGC — Micro Gold',           tickSize: 0.10, tickValue: 1.00,  minisEquivalent: 0.1 },
    CL:  { label: 'CL — Crude Oil',             tickSize: 0.01, tickValue: 10.00, minisEquivalent: 1 },
    MCL: { label: 'MCL — Micro Crude Oil',      tickSize: 0.01, tickValue: 1.00,  minisEquivalent: 0.1 },
  };

  const MODELS = [
    { id: 'claude-sonnet-5',          label: 'Claude Sonnet 5 (recommended)' },
    { id: 'claude-fable-5',           label: 'Claude Fable 5 (most capable, pricier)' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (cheapest, weaker reads)' },
  ];

  /* Merge user overrides from Settings on top of a preset. */
  function planWithOverrides(planId, overrides) {
    const base = PLANS[planId] || PLANS.rapid25k;
    return Object.assign({}, base, overrides || {});
  }

  return { PLANS, INSTRUMENTS, MODELS, planWithOverrides };
})();
