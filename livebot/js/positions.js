/* Livebot — position manager. One SXExit engine instance per open position;
 * mirrors scalper/js/trader.js's step() order (onTick → fills → decide →
 * EXTEND/SELL_NOW/tranches) but drives a real (or paper) broker and multiple
 * concurrent positions. The smart-exit engine is reused verbatim, not
 * reimplemented. The hold timer is anchored at the CONFIRMED fill, not the
 * decision, because live confirmation can eat 1-2s of a 4s hold. */
'use strict';

const SXExit = require('../../scalper/js/exit.js');

function createPositionManager(opts) {
  const cfg = opts.cfg;
  const broker = opts.broker;
  const risk = opts.risk;
  const store = opts.store;
  const selfWallet = opts.selfWallet || 'you';
  const onClose = opts.onClose || (() => {});
  const log = opts.log || (() => {});
  const uid = opts.uid || (() => Math.random().toString(36).slice(2, 9));
  const wallTime = opts.now || (() => Date.now());

  const positions = new Map();              // mint -> position

  function open(mint, meta, tick) {
    if (positions.has(mint)) return;
    const engine = SXExit.create(Object.assign({}, cfg.EXIT, { selfWallet, devWallet: meta.creator }));
    const buyOrderId = broker.request('buy', mint, risk.perTradeSol(), { tick, devWallet: meta.creator });
    positions.set(mint, {
      mint, meta, engine, state: 'ENTERING',
      buyOrderId, entry: null,
      remainingBase: 0, proceedsSol: 0, sellFeesTotal: 0,
      exits: [], tranche: null, pendingSellId: null, pendingSellSize: 0,
      exitReason: null, impactAtExit: 0, extensions: [], sigs: { buy: null, sell: null },
    });
    log(tick.t, 'enter', mint, 'buying ' + risk.perTradeSol() + ' SOL — ' + (meta.reasons || []).join(' '));
  }

  function applyBuyFill(pos, fill, tick) {
    if (!fill.ok) {
      pos.state = 'CLOSED';                  // entry never happened — no trade, no PnL
      log(tick.t, 'abort', pos.mint, 'buy failed: ' + fill.failReason);
      finish(pos, null);
      return;
    }
    pos.entry = {
      t: fill.t, solIn: risk.perTradeSol(), baseOut: fill.baseOut,
      solSpent: fill.solSpent, execPrice: fill.execPrice, fees: fill.fees,
    };
    pos.remainingBase = fill.baseOut;
    pos.sigs.buy = fill.sig || null;
    pos.state = 'OPEN';
    pos.engine.onEntry({ t: fill.t, price: fill.execPrice, pool: tick.pool, holders: tick.holders, sizeBase: fill.baseOut });
    log(fill.t, 'open', pos.mint, 'filled ' + fill.baseOut.toExponential(3) + ' tokens @ ' + fill.execPrice.toExponential(3));
  }

  function applySellFill(pos, fill, tick) {
    pos.pendingSellId = null;
    if (!fill.ok) {
      // Persistent sell failure (dead pool / restricted): write off whatever is left.
      log(tick.t, 'exit', pos.mint, 'sell failed: ' + fill.failReason + ' — remaining written off');
      pos.remainingBase = 0;
      finalizeClose(pos, tick, true);
      return;
    }
    pos.proceedsSol += fill.solOutNet;
    pos.sellFeesTotal += fill.fees.total;
    pos.remainingBase = Math.max(0, pos.remainingBase - pos.pendingSellSize);
    pos.impactAtExit = fill.impactPct;
    pos.sigs.sell = fill.sig || pos.sigs.sell;
    pos.exits.push({ t: fill.t, solOutNet: fill.solOutNet, impactPct: fill.impactPct, fees: fill.fees });
    log(fill.t, 'exit', pos.mint, 'sold' + (pos.tranche ? ' tranche' : '') + ' → ' +
      fill.solOutNet.toFixed(5) + ' SOL @ impact ' + fill.impactPct.toFixed(2) + '%');
    if (pos.remainingBase <= 1e-6 || !pos.tranche) finalizeClose(pos, tick, false);
  }

  function requestSell(pos, size, tick) {
    pos.pendingSellSize = size;
    pos.pendingSellId = broker.request('sell', pos.mint, size, { tick, devWallet: pos.meta.creator });
  }

  function initiateExit(pos, d, tick) {
    pos.exitReason = d.reason;
    const emergency = d.reason.indexOf('EMERGENCY_') === 0;
    if (emergency) log(tick.t, 'emergency', pos.mint, d.reason.replace('EMERGENCY_', '').replace(/_/g, ' '));
    const parts = cfg.EXIT.impactSplitParts || 2;
    if (!emergency && d.detail.split && parts > 1) {
      pos.tranche = { parts, partSize: pos.remainingBase / parts, reason: d.reason };
      requestSell(pos, pos.tranche.partSize, tick);
    } else {
      requestSell(pos, pos.remainingBase, tick);
    }
  }

  function finalizeClose(pos, tick, failed) {
    const rec = buildRecord(pos, failed);
    pos.state = (failed && pos.proceedsSol === 0) ? 'WRITTEN_OFF' : 'CLOSED';
    store.appendTrade(rec);
    risk.settle(rec.pnlNetSol);
    finish(pos, rec);
  }

  function finish(pos, rec) {
    positions.delete(pos.mint);
    onClose(pos, rec);
  }

  function buildRecord(pos, failed) {
    const cost = pos.entry ? pos.entry.solSpent : 0;
    const proceeds = round(pos.proceedsSol, 9);
    const pnlNetSol = round(proceeds - cost, 9);
    const lastExitT = pos.exits.length ? pos.exits[pos.exits.length - 1].t : (pos.entry ? pos.entry.t : 0);
    return {
      id: uid(), wallTime: wallTime(),
      mode: broker.mode === 'live' ? 'live' : 'paper',
      mint: pos.mint, symbol: pos.meta.symbol || '', creator: pos.meta.creator || '',
      entry: pos.entry ? {
        t: pos.entry.t, solIn: pos.entry.solIn, solSpent: pos.entry.solSpent,
        baseOut: pos.entry.baseOut, execPrice: pos.entry.execPrice, fees: pos.entry.fees,
      } : null,
      exit: {
        t: lastExitT, solOutNet: proceeds, impactPct: round(pos.impactAtExit, 3),
        reason: pos.exitReason || 'NONE', failed: !!failed, tranches: pos.exits.length,
        fees: sumFees(pos.exits),
      },
      pnlNetSol, pnlPct: cost > 0 ? round(pnlNetSol / cost * 100, 2) : 0,
      holdMs: pos.entry ? lastExitT - pos.entry.t : 0,
      extensions: pos.extensions.length,
      enterReasons: pos.meta.reasons || [],
      sig: pos.sigs,
    };
  }

  /* Main per-tick step for a watched mint. */
  function onTick(mint, tick) {
    const settled = broker.onTick(mint, tick);
    for (const fill of settled) {
      const pos = positions.get(mint);
      if (!pos) continue;
      if (fill.kind === 'buy' && pos.buyOrderId === fill.orderId) applyBuyFill(pos, fill, tick);
      else if (fill.kind === 'sell') applySellFill(pos, fill, tick);
    }
    const pos = positions.get(mint);
    if (!pos || pos.state !== 'OPEN') return;

    pos.engine.onTick(tick);

    if (pos.exitReason) {
      // winding down: fire the next tranche once the previous fill has settled
      if (pos.tranche && !pos.pendingSellId && pos.remainingBase > 1e-6) requestSell(pos, Math.min(pos.tranche.partSize, pos.remainingBase), tick);
      return;
    }

    const d = pos.engine.decide(tick.t);
    if (d.action === 'EXTEND') {
      pos.extensions.push({ t: tick.t, newDeadline: d.detail.holdDeadline });
      log(tick.t, 'extend', pos.mint, 'hold extended to ' + ((d.detail.holdDeadline - pos.entry.t) / 1000).toFixed(1) + 's');
    } else if (d.action === 'SELL_NOW') {
      initiateExit(pos, d, tick);
    }

    // belt-and-braces: force-sell a stale position regardless of engine state
    if (!pos.exitReason && pos.entry && tick.t - pos.entry.t >= cfg.TRADE.maxPositionAgeMs) {
      pos.exitReason = 'MAX_AGE';
      requestSell(pos, pos.remainingBase, tick);
      log(tick.t, 'exit', pos.mint, 'max position age — force sell');
    }
  }

  /* External force-exit (feed lost, panic, graduation). Best-effort market sell. */
  function forceExit(mint, tick, reason) {
    const pos = positions.get(mint);
    if (!pos || pos.state !== 'OPEN' || pos.exitReason) return;
    if (!pos.entry) { pos.state = 'CLOSED'; finish(pos, null); return; }
    pos.exitReason = reason;
    requestSell(pos, pos.remainingBase, tick);
    log(tick.t, 'exit', mint, 'force exit: ' + reason);
  }

  function has(mint) { return positions.has(mint); }
  function count() { return positions.size; }
  function get(mint) { return positions.get(mint); }
  function all() { return Array.from(positions.values()); }

  return { open, onTick, forceExit, has, count, get, all };
}

function sumFees(exits) {
  const t = { platform: 0, portal: 0, priority: 0, network: 0, total: 0 };
  for (const e of exits) for (const k of Object.keys(t)) t[k] = round(t[k] + (e.fees[k] || 0), 9);
  return t;
}
function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createPositionManager };
