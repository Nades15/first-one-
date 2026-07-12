/* Livebot — risk manager. Enforces the hard caps, the daily loss stop, and
 * the go-live stats gate; owns the panic/halt state. Every real-money limit is
 * checked here, and the per-trade ceiling is a FROZEN constant that config can
 * lower but never raise. */
'use strict';

/* Absolute ceiling on live position size — a frozen constant, not a config
 * default. Lowering RISK.perTradeCapSol in config works; raising it above this
 * does nothing in live mode. */
const HARD_PER_TRADE_CAP_SOL = 0.05;

const MODE = {
  PAPER: 'PAPER', LIVE: 'LIVE',
  HALTED_DAILY: 'HALTED_DAILY', HALTED_PANIC: 'HALTED_PANIC',
};

function utcDate(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function createRisk(opts) {
  const cfg = opts.cfg.RISK;
  const store = opts.store;
  const live = !!opts.live;
  const now = opts.now || (() => Date.now());
  const getBalance = opts.getBalance || null;       // async () => SOL, live only

  const perTradeCap = Math.min(cfg.perTradeCapSol, live ? HARD_PER_TRADE_CAP_SOL : cfg.perTradeCapSol);

  let ledger = store.readLedger() || { dateUtc: utcDate(now()), realizedNetSol: 0, trades: 0, halted: false };
  let panicked = false;
  let balanceCache = { at: 0, sol: null };

  function rollIfNewDay() {
    const today = utcDate(now());
    if (ledger.dateUtc !== today) {
      ledger = { dateUtc: today, realizedNetSol: 0, trades: 0, halted: false };
      store.writeLedger(ledger);
    }
  }

  function mode() {
    if (panicked) return MODE.HALTED_PANIC;
    rollIfNewDay();
    if (ledger.halted) return MODE.HALTED_DAILY;
    return live ? MODE.LIVE : MODE.PAPER;
  }

  /* Synchronous entry gate (wallet-balance check is done separately/async in
   * live mode via canEnterAsync). openCount = positions currently open. */
  function canEnter(openCount) {
    const m = mode();
    if (m === MODE.HALTED_PANIC) return { ok: false, reason: 'PANIC' };
    if (m === MODE.HALTED_DAILY) return { ok: false, reason: 'DAILY_STOP' };
    if (openCount >= cfg.maxConcurrent) return { ok: false, reason: 'MAX_CONCURRENT' };
    return { ok: true, sizeSol: perTradeCap };
  }

  /* Live-only balance floor check (cached ~10s). Returns {ok,reason}. */
  async function canAffordLive(sizeSol) {
    if (!live || !getBalance) return { ok: true };
    const t = now();
    if (t - balanceCache.at > 10000) {
      try { balanceCache = { at: t, sol: await getBalance() }; }
      catch (e) { return { ok: false, reason: 'BALANCE_UNKNOWN' }; }
    }
    if (balanceCache.sol == null) return { ok: false, reason: 'BALANCE_UNKNOWN' };
    if (balanceCache.sol - sizeSol < cfg.minWalletFloorSol) return { ok: false, reason: 'WALLET_FLOOR' };
    return { ok: true };
  }

  /* Record a closed trade's net PnL; trips the daily halt if the loss stop is
   * breached. */
  function settle(pnlNetSol) {
    rollIfNewDay();
    ledger.realizedNetSol = round(ledger.realizedNetSol + (Number(pnlNetSol) || 0), 9);
    ledger.trades++;
    if (ledger.realizedNetSol <= -cfg.dailyStopSol) ledger.halted = true;
    store.writeLedger(ledger);
    return ledger;
  }

  /* Go-live gate: paper log must show enough completed trades AND net-positive
   * PnL after fees. */
  function gateStatus() {
    const s = store.gateStats();
    return {
      paperTrades: s.paperTrades, paperNetSol: s.paperNetSol,
      required: cfg.gateMinTrades,
      unlocked: s.paperTrades >= cfg.gateMinTrades && s.paperNetSol > 0,
    };
  }

  function panic() { panicked = true; }
  function isPanicked() { return panicked; }
  function ledgerState() { rollIfNewDay(); return Object.assign({ dailyStopSol: cfg.dailyStopSol }, ledger); }
  function perTradeSol() { return perTradeCap; }

  return {
    MODE, mode, canEnter, canAffordLive, settle, gateStatus,
    panic, isPanicked, ledgerState, perTradeSol,
    get maxConcurrent() { return cfg.maxConcurrent; },
  };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createRisk, HARD_PER_TRADE_CAP_SOL, MODE };
