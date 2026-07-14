/* Fairline — risk manager (Livebot risk.js pattern). Enforces the per-trade
 * stake ceiling, max concurrency, the UTC-daily loss stop, and the stats
 * gate. Fairline is paper-ONLY — there is no live mode to arm — but the caps
 * are enforced anyway so the paper log measures a strategy someone could
 * actually run, and the frozen ceiling is already in place if a live broker
 * ever lands. */
'use strict';

/* Absolute ceiling on stake per position — a frozen constant, not a config
 * default. Config can lower RISK.perTradeCapUsd; raising it past this does
 * nothing. */
const HARD_PER_TRADE_CAP_USD = 10;

const MODE = { PAPER: 'PAPER', HALTED_DAILY: 'HALTED_DAILY', HALTED_PANIC: 'HALTED_PANIC' };

function utcDate(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function createRisk(opts) {
  const cfg = opts.cfg.RISK;
  const store = opts.store;
  const now = opts.now || (() => Date.now());

  const perTradeCap = Math.min(cfg.perTradeCapUsd, HARD_PER_TRADE_CAP_USD);

  let ledger = store.readLedger() || { dateUtc: utcDate(now()), realizedNetUsd: 0, trades: 0, halted: false };
  let panicked = false;

  function rollIfNewDay() {
    const today = utcDate(now());
    if (ledger.dateUtc !== today) {
      ledger = { dateUtc: today, realizedNetUsd: 0, trades: 0, halted: false };
      store.writeLedger(ledger);
    }
  }

  function mode() {
    if (panicked) return MODE.HALTED_PANIC;
    rollIfNewDay();
    if (ledger.halted) return MODE.HALTED_DAILY;
    return MODE.PAPER;
  }

  function canEnter(openCount) {
    const m = mode();
    if (m === MODE.HALTED_PANIC) return { ok: false, reason: 'PANIC' };
    if (m === MODE.HALTED_DAILY) return { ok: false, reason: 'DAILY_STOP' };
    if (openCount >= cfg.maxConcurrent) return { ok: false, reason: 'MAX_CONCURRENT' };
    return { ok: true, sizeUsd: perTradeCap };
  }

  /* Record a closed trade's net PnL; trips the daily halt on breach. */
  function settle(pnlNetUsd) {
    rollIfNewDay();
    ledger.realizedNetUsd = round(ledger.realizedNetUsd + (Number(pnlNetUsd) || 0), 4);
    ledger.trades++;
    if (ledger.realizedNetUsd <= -cfg.dailyStopUsd) ledger.halted = true;
    store.writeLedger(ledger);
    return ledger;
  }

  /* The gate: enough settled paper trades AND net-positive after fees. Green
   * means "the plumbing works and the edge survived fees over a sample" —
   * nothing more. */
  function gateStatus() {
    const s = store.gateStats();
    return {
      paperTrades: s.paperTrades, paperNetUsd: s.paperNetUsd,
      required: cfg.gateMinTrades,
      unlocked: s.paperTrades >= cfg.gateMinTrades && s.paperNetUsd > 0,
    };
  }

  function panic() { panicked = true; }
  function isPanicked() { return panicked; }
  function ledgerState() { rollIfNewDay(); return Object.assign({ dailyStopUsd: cfg.dailyStopUsd }, ledger); }
  function perTradeUsd() { return perTradeCap; }

  return {
    MODE, mode, canEnter, settle, gateStatus,
    panic, isPanicked, ledgerState, perTradeUsd,
    get maxConcurrent() { return cfg.maxConcurrent; },
  };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createRisk, HARD_PER_TRADE_CAP_USD, MODE };
