/* MFFU Trade Copilot — rules engine.
 * Pure functions only (no DOM, no storage) so the math is unit-testable
 * in node. Loaded in the browser via window, in node via module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * Replay the EOD-trailing Max Loss Limit over completed days.
   * days: array of { endBalance } in chronological order.
   * The floor starts at startBalance - maxLoss, rises to
   * (eodBalance - maxLoss) after each day it improves, and is capped at
   * startBalance + lockBuffer, where it locks permanently.
   * Returns { floor, locked }.
   */
  function replayFloor(plan, days) {
    const lockLevel = plan.startBalance + plan.lockBuffer;
    let floor = plan.startBalance - plan.maxLoss;
    for (const d of days || []) {
      floor = Math.max(floor, d.endBalance - plan.maxLoss);
      if (floor >= lockLevel) return { floor: lockLevel, locked: true };
    }
    return { floor, locked: false };
  }

  /* Dollars between the current balance and a breach. <= 0 means breached. */
  function distanceToBreach(balance, floor) {
    return balance - floor;
  }

  /*
   * Consistency check (plans with consistencyPct > 0, e.g. Starter/Flex 50%).
   * dayPnls: array of daily net P&L including today's running figure.
   * Rule: when you finish the eval, your best day must be <= pct% of total profit.
   * Returns ratio (bestDay / total), the minimum total profit that would make
   * the current best day compliant, and whether it currently passes.
   */
  function consistency(dayPnls, consistencyPct) {
    const pct = (consistencyPct || 0) / 100;
    const wins = (dayPnls || []).filter(p => p > 0);
    const total = (dayPnls || []).reduce((a, b) => a + b, 0);
    const bestDay = wins.length ? Math.max.apply(null, wins) : 0;
    if (!pct || bestDay <= 0) {
      return { applies: pct > 0, bestDay, total, ratio: 0, requiredTotal: 0, ok: true };
    }
    const ratio = total > 0 ? bestDay / total : 1;
    return {
      applies: true,
      bestDay,
      total,
      ratio,
      requiredTotal: bestDay / pct, // total profit needed so bestDay/total <= pct
      ok: ratio <= pct + 1e-9,
    };
  }

  /*
   * Max contracts for a proposed stop, risking at most riskPct% of the
   * distance-to-breach, clamped to the plan's contract limit.
   * slTicks: stop distance in ticks. instrument: { tickValue, minisEquivalent }.
   * Returns { contracts, riskDollars, perContractRisk, cap, capReason }.
   */
  function positionSize(opts) {
    const { distToBreach, riskPct, slTicks, instrument, plan } = opts;
    const perContractRisk = slTicks * instrument.tickValue;
    const riskBudget = Math.max(0, distToBreach) * (riskPct / 100);
    if (perContractRisk <= 0) {
      return { contracts: 0, riskDollars: 0, perContractRisk: 0, cap: 0, capReason: 'invalid-stop' };
    }
    const byRisk = Math.floor(riskBudget / perContractRisk);
    const planCap = instrument.minisEquivalent >= 1
      ? plan.maxMinis
      : Math.round(plan.maxMinis / instrument.minisEquivalent); // e.g. 3 minis -> 30 micros
    const contracts = Math.max(0, Math.min(byRisk, planCap));
    return {
      contracts,
      riskDollars: contracts * perContractRisk,
      perContractRisk,
      cap: planCap,
      capReason: byRisk > planCap ? 'plan-limit' : 'risk-budget',
    };
  }

  /* Price distance -> whole ticks (rounded to nearest tick). */
  function priceToTicks(priceDistance, tickSize) {
    return Math.round(Math.abs(priceDistance) / tickSize);
  }

  /*
   * Full pre-trade audit combining everything the UI needs to vet a signal.
   * Returns a verdict: 'ok' | 'reduce' | 'block' with human-readable reasons.
   */
  function preTradeCheck(opts) {
    const { plan, balance, floor, riskPct, entry, stopLoss, instrument, dayPnls } = opts;
    const dist = distanceToBreach(balance, floor);
    const reasons = [];
    if (dist <= 0) {
      return { verdict: 'block', reasons: ['Account is at or below the Max Loss Limit — do not trade.'], sizing: null, dist };
    }
    const slTicks = priceToTicks(entry - stopLoss, instrument.tickSize);
    if (!slTicks) {
      return { verdict: 'block', reasons: ['Stop loss equals entry — no valid risk defined.'], sizing: null, dist };
    }
    const sizing = positionSize({ distToBreach: dist, riskPct, slTicks, instrument, plan });
    if (sizing.contracts === 0) {
      reasons.push('Even 1 contract of ' + (instrument.symbol || '') + ' with this stop risks more than ' + riskPct + '% of your remaining $' + Math.round(dist) + ' buffer.');
      return { verdict: 'block', reasons, sizing, dist, slTicks };
    }
    let verdict = 'ok';
    if (sizing.perContractRisk * sizing.contracts > dist * 0.5) {
      verdict = 'reduce';
      reasons.push('This position risks over half your remaining buffer — consider fewer contracts.');
    }
    const cons = consistency(dayPnls, plan.consistencyPct);
    if (cons.applies && !cons.ok) {
      verdict = verdict === 'ok' ? 'reduce' : verdict;
      reasons.push('Consistency: your best day is ' + Math.round(cons.ratio * 100) + '% of total profit (limit ' + plan.consistencyPct + '%). You need $' + Math.ceil(cons.requiredTotal) + ' total profit before finishing.');
    }
    return { verdict, reasons, sizing, dist, slTicks, cons };
  }

  /* Progress toward the profit target. */
  function targetProgress(plan, balance) {
    const profit = balance - plan.startBalance;
    return {
      profit,
      target: plan.profitTarget,
      pct: Math.max(0, Math.min(1, profit / plan.profitTarget)),
      remaining: Math.max(0, plan.profitTarget - profit),
      hit: profit >= plan.profitTarget,
    };
  }

  return { replayFloor, distanceToBreach, consistency, positionSize, priceToTicks, preTradeCheck, targetProgress };
});
