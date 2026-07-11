/* Pulse — paper-trade run loop. Wires one simulator to one smart-exit engine
 * instance and, in parallel, runs a SHADOW simulator from the same seed whose
 * position exits on a fixed timer with no engine at all. The shadow is an
 * exact counterfactual (the smart run's own exit trade can never contaminate
 * the baseline's pool), so every trade record carries "what the dumb 4s timer
 * would have made" next to what the smart exit made. Advances only via
 * step() — node tests drive it in a loop, the browser on an interval. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./sim.js'), require('./exit.js'));
  } else {
    root.SXTrader = factory(root.SXSim, root.SXExit);
  }
})(typeof self !== 'undefined' ? self : this, function (SXSim, SXExit) {
  'use strict';

  function round(x, dp) {
    const m = Math.pow(10, dp);
    return Math.round(x * m) / m;
  }

  function flagsClean(flags) {
    for (const k of Object.keys(flags || {})) if (flags[k]) return false;
    return true;
  }

  /* opts: { scenarioId, seed, tickMs?, simCfg?, exitCfg, trade: { buySizeSol,
   *         entryDelayMs }, solUsd } — exitCfg/trade default sensibly. */
  function createRun(opts) {
    const exitCfg = Object.assign({}, SXExit.DEFAULT_CFG, opts.exitCfg || {});
    const trade = Object.assign({ buySizeSol: 0.5, entryDelayMs: 1000 }, opts.trade || {});
    const solUsd = Number(opts.solUsd) || 150;
    const mk = () => SXSim.createSim({
      scenario: opts.scenarioId, seed: opts.seed, tickMs: opts.tickMs, sim: opts.simCfg,
    });
    const sim = mk();
    const shadow = mk();
    const ex = SXExit.create(exitCfg);

    let tick = null;
    let position = null;          // { t, price, sizeBase, costQuote }
    let exit = null;              // { t, price, proceedsQuote, impactPct, reason, failed }
    let baseline = null;          // { exitT, proceedsQuote, failed } once entered
    let shadowSize = 0;
    let tranche = null;           // { baseLeft, parts, reason } while split-selling
    let lastDecision = null;
    let aborted = false;
    const events = [];            // { t, kind, text } for the UI feed

    function log(t, kind, text) { events.push({ t, kind, text }); }

    function sellThrough(baseIn, reason) {
      const res = sim.execute({ side: 'sell', baseIn, wallet: 'you' });
      if (!res.ok) {
        exit = { t: tick.t, price: tick.price, proceedsQuote: exit ? exit.proceedsQuote : 0,
          impactPct: 0, reason, failed: true };
        log(tick.t, 'exit', 'SELL FAILED (' + res.reason + ') — position written off');
        return;
      }
      const prev = exit && exit.partial ? exit : null;
      const proceeds = (prev ? prev.proceedsQuote : 0) + res.quoteOut;
      const soldBase = (prev ? prev.soldBase : 0) + res.baseIn;
      exit = {
        t: tick.t, price: res.execPrice, proceedsQuote: proceeds,
        impactPct: prev ? (prev.impactPct * prev.soldBase + res.impactPct * res.baseIn) / soldBase
          : res.impactPct,
        reason, failed: false, soldBase, partial: !!tranche,
      };
      log(tick.t, 'exit', 'sold ' + (tranche ? 'tranche ' : '') + 'at impact ' +
        round(res.impactPct, 2) + '% — ' + reason);
    }

    function step() {
      if (finished()) return null;
      tick = sim.next();
      const shadowTick = shadow.next();       // lockstep clock
      ex.onTick(tick);

      /* entry */
      if (!position && !aborted && !exit && tick.t >= trade.entryDelayMs) {
        if (!flagsClean(tick.flags)) {
          aborted = true;
          log(tick.t, 'abort', 'market flags dirty before entry — no trade');
        } else {
          const res = sim.execute({ side: 'buy', quoteIn: trade.buySizeSol, wallet: 'you' });
          const sres = shadow.execute({ side: 'buy', quoteIn: trade.buySizeSol, wallet: 'you' });
          shadowSize = sres.baseOut;
          position = { t: tick.t, price: res.execPrice, sizeBase: res.baseOut, costQuote: trade.buySizeSol };
          baseline = { exitT: tick.t + exitCfg.baseHoldMs, proceedsQuote: null, failed: false };
          ex.onEntry({ t: tick.t, price: tick.price, pool: tick.pool, holders: tick.holders, sizeBase: res.baseOut });
          log(tick.t, 'entry', 'bought ' + trade.buySizeSol + ' SOL at entry impact ' +
            round((1 - tick.price / res.execPrice) * 100, 2) + '%');
        }
      }

      /* smart exit */
      if (position && (!exit || tranche)) {
        if (tranche) {
          const part = Math.min(tranche.partSize, tranche.baseLeft);
          sellThrough(part, tranche.reason);
          tranche.baseLeft -= part;
          if (tranche.baseLeft <= 1e-12 || (exit && exit.failed)) tranche = null;
        } else {
          const d = ex.decide(tick.t);
          lastDecision = d;
          if (d.action === 'EXTEND') {
            log(tick.t, 'extend', 'strong momentum — hold extended to ' +
              round((d.detail.holdDeadline - position.t) / 1000, 1) + 's');
          } else if (d.action === 'SELL_NOW') {
            const emergency = d.reason.indexOf('EMERGENCY_') === 0;
            if (emergency) log(tick.t, 'emergency', d.reason.replace('EMERGENCY_', '').replace(/_/g, ' '));
            if (!emergency && d.detail.split) {
              const partSize = position.sizeBase / exitCfg.impactSplitParts;
              tranche = { baseLeft: position.sizeBase - partSize, partSize, reason: d.reason };
              sellThrough(partSize, d.reason);
              if (exit && exit.failed) tranche = null;
            } else {
              sellThrough(position.sizeBase, d.reason);
            }
          }
        }
      }

      /* baseline exit: fixed timer, no engine, in the shadow world */
      if (baseline && baseline.proceedsQuote === null && tick.t >= baseline.exitT) {
        const r = shadow.execute({ side: 'sell', baseIn: shadowSize, wallet: 'you' });
        baseline.proceedsQuote = r.ok ? r.quoteOut : 0;
        baseline.failed = !r.ok;
        log(tick.t, 'baseline', 'fixed-timer benchmark sold' + (r.ok ? '' : ' — FAILED'));
      }

      return { tick, decision: lastDecision, finished: finished() };
    }

    function finished() {
      if (aborted) return true;
      if (tick && sim.done()) return true;    // safety: scenario ran out
      return !!(exit && !tranche && baseline && baseline.proceedsQuote !== null);
    }

    /* Deterministic trade record (no ids/timestamps — the app adds those). */
    function result() {
      if (!finished() || aborted || !position) return null;
      const cost = position.costQuote;
      const proceeds = exit.proceedsQuote || 0;
      const pnlQuote = proceeds - cost;
      const basePnl = (baseline.proceedsQuote || 0) - cost;
      return {
        scenarioId: opts.scenarioId, seed: opts.seed,
        entry: { t: position.t, price: position.price, sizeBase: position.sizeBase, costQuote: cost },
        exit: {
          t: exit.t, price: exit.price, proceedsQuote: round(proceeds, 6),
          impactPct: round(exit.impactPct, 3), reason: exit.reason, failed: exit.failed,
        },
        extensions: ex.extensions(),
        pnlQuote: round(pnlQuote, 6),
        pnlUsd: round(pnlQuote * solUsd, 2),
        pnlPct: round(pnlQuote / cost * 100, 2),
        baseline: {
          exitT: baseline.exitT, proceedsQuote: round(baseline.proceedsQuote || 0, 6),
          pnlQuote: round(basePnl, 6), pnlPct: round(basePnl / cost * 100, 2), failed: baseline.failed,
        },
        edgeQuote: round(pnlQuote - basePnl, 6),
        edgeUsd: round((pnlQuote - basePnl) * solUsd, 2),
      };
    }

    function state() {
      return {
        t: tick ? tick.t : 0, tick, position, exit, baseline, aborted,
        holdDeadline: position ? ex.snapshot().holdDeadline : 0,
        gauges: ex.snapshot(), lastDecision, events, finished: finished(),
      };
    }

    return { step, state, result, finished };
  }

  return { createRun };
});
