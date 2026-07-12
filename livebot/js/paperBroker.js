/* Livebot — paper broker. Simulated fills against LIVE bonding-curve reserves
 * using the same constant-product math as the sim, plus honest fees and a
 * latency model. Charges the full fee stack so the go-live gate measures net
 * edge. Imports no @solana/web3.js — paper mode and tests stay network-free.
 *
 * Fills are tick-driven, not promise-driven, so replay is fully deterministic:
 *   request(kind, mint, size, ctx) -> orderId        (enqueues, does not fill)
 *   onTick(mint, tick) -> [ settled fill results ]    (drains fills whose
 *       target time — decision time + paperLatencyMs — has arrived, priced
 *       against THAT tick's pool: a dump landing in the latency window eats
 *       our fill exactly as it would live)
 * Our paper order is fictional, so it is priced on a COPY of the reserves and
 * never moves the observed pool. */
'use strict';

const { amm } = require('../../scalper/js/sim.js');
const { computeFees, round } = require('./broker.js');

function createPaperBroker(cfg) {
  // The priority fee is a trade parameter but belongs in the fee math.
  const feeCfg = Object.assign({}, cfg.FEES, {
    priorityFeeSol: cfg.FEES.priorityFeeSol != null ? cfg.FEES.priorityFeeSol : cfg.TRADE.priorityFeeSol,
  });
  const latencyMs = cfg.TRADE.paperLatencyMs;
  const poolSnap = new Map();               // mint -> { base, quote } (latest tick)
  const pending = [];                       // { orderId, kind, mint, size, targetT }
  let seq = 0;

  function request(kind, mint, size, ctx) {
    const orderId = ++seq;
    pending.push({ orderId, kind, mint, size, targetT: ctx.tick.t + latencyMs });
    return orderId;
  }

  function fillBuy(pool, solIn, t) {
    const fees = computeFees(solIn, feeCfg);
    if (!pool || !(pool.base > 0) || !(pool.quote > 0)) {
      return { ok: false, t, failReason: 'NO_LIQUIDITY', fees };
    }
    const curveIn = solIn - fees.platform - fees.portal;       // fees skimmed before the curve
    const baseOut = amm.buy({ base: pool.base, quote: pool.quote }, curveIn);
    const solSpent = round(solIn + fees.priority + fees.network, 9);  // total wallet debit
    return {
      ok: true, t, baseOut, solSpent,
      execPrice: baseOut > 0 ? solSpent / baseOut : 0, fees, sig: null,
    };
  }

  function fillSell(pool, baseIn, t) {
    if (!pool || !(pool.base > 0) || !(pool.quote > 0)) {
      return { ok: false, t, failReason: 'NO_LIQUIDITY', fees: computeFees(0, feeCfg), impactPct: 0 };
    }
    const impactPct = amm.impactPct(pool, baseIn);
    const gross = amm.sell({ base: pool.base, quote: pool.quote }, baseIn);
    const fees = computeFees(gross, feeCfg);
    const solOutNet = round(gross - fees.total, 9);
    return {
      ok: true, t, solOutNet, impactPct: round(impactPct, 4),
      execPrice: baseIn > 0 ? solOutNet / baseIn : 0, fees, sig: null,
    };
  }

  function onTick(mint, tick) {
    if (tick && tick.pool) poolSnap.set(mint, { base: tick.pool.base, quote: tick.pool.quote });
    const settled = [];
    for (let i = pending.length - 1; i >= 0; i--) {
      const o = pending[i];
      if (o.mint !== mint || tick.t < o.targetT) continue;
      pending.splice(i, 1);
      const pool = poolSnap.get(mint);
      const res = o.kind === 'buy' ? fillBuy(pool, o.size, tick.t) : fillSell(pool, o.size, tick.t);
      res.orderId = o.orderId; res.kind = o.kind; res.mint = mint;
      settled.push(res);
    }
    return settled;
  }

  return { request, onTick, mode: 'paper', kind: 'paper' };
}

module.exports = { createPaperBroker };
