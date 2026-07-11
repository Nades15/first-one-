/* Pulse — adaptive smart-exit engine. The hold timer is the DEFAULT exit,
 * not the only one: before selling, the engine analyzes momentum (price
 * velocity, buy/sell flow, pressure trend), volume acceleration, and
 * liquidity (expected sell impact), then extends the hold on strength, cuts
 * it on weakness, and fires emergency exits (whale dump, liquidity pull,
 * contract-risk flip, sell restriction) immediately.
 *
 * Pure over its inputs: no DOM, no clocks, no RNG — feed it ticks, ask it to
 * decide. Runs in node for tests and in the browser as window.SXExit. It is
 * deliberately feed-agnostic (only needs { t, price, trades, pool, holders,
 * flags } ticks) so it could be pointed at a real stream later; detectors
 * that need wallet-attributed trades or holder data simply go inert when a
 * feed can't provide them. */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SXExit = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_CFG = {
    baseHoldMs: 4000, maxHoldMs: 10000, extendStepMs: 1500, minEvalMs: 750,
    velEmaTicks: 8, strongVelPctPerSec: 2.0, weakVelPctPerSec: -1.5,
    txWindowMs: 3000, strongBuyRatio: 0.62, weakBuyRatio: 0.42,
    pressureRiseMin: -0.15, pressureFallMax: -0.08,
    volBucketMs: 1000, volRecentBuckets: 2, volBaseBuckets: 4,
    strongVolAccel: 1.2, weakVolAccel: 0.4,
    maxImpactPct: 8, impactDeferMaxMs: 1500, splitImpactPct: 15, impactSplitParts: 2,
    liqPullPct: 30, liqPullWindowMs: 2000,
    whaleHolderPct: 4, whaleSellPortion: 0.35, whaleWindowMs: 2500, whaleSellQuotePct: 3,
    honeypotMinTx: 6, honeypotGapMs: 2500,
    riskFlags: ['mintEnabled', 'lpUnlocked', 'blacklistRisk'],
    selfWallet: 'you',          // our own trades are excluded from flow analytics
    devWallet: 'dev',           // treated as a whale regardless of holding size
  };

  /* Expected % below spot that selling baseIn into pool would execute at.
   * (Constant-product; duplicated from sim on purpose — the engine must not
   * depend on the simulator.) */
  function sellImpactPct(pool, baseIn) {
    if (!pool || !(baseIn > 0) || !(pool.base > 0)) return 0;
    return (baseIn / (pool.base + baseIn)) * 100;
  }

  function create(userCfg) {
    const cfg = Object.assign({}, DEFAULT_CFG, userCfg || {});
    const ringMs = Math.max(
      cfg.txWindowMs,
      cfg.volBucketMs * (cfg.volRecentBuckets + cfg.volBaseBuckets),
      cfg.whaleWindowMs, cfg.honeypotGapMs
    );

    let entry = null;             // { t, price, sizeBase }
    let deadline = 0;
    let extensions = [];
    let deferSince = null;
    let emergency = null;         // latched EMERGENCY_* reason
    let closedReason = null;      // latched once SELL_NOW is issued

    let startT = null, prevT = null, prevPrice = null, velEma = null;
    let lastTick = null;
    let prevFlags = null;
    let sellsSeenEver = false;
    let entryVolRate = 0;         // SOL/s of flow observed before entry

    const ring = [];              // non-self trades: { t, side, quote, wallet, poolQuote }
    const liqRing = [];           // { t, quote }
    const pctRing = {};           // wallet -> [{ t, pct }] (whales only)
    let curHolders = {};          // wallet -> pct

    let sig = {                   // cached signal readout, refreshed every tick
      velPctPerSec: 0, buyVolRatio: 0.5, pressureTrend: 0, volAccel: 1,
      momentum: 'neutral',
    };

    /* ------------------------- per-tick bookkeeping ------------------------- */

    function prune(arr, now, ms) {
      while (arr.length && arr[0].t <= now - ms) arr.shift();
    }

    function flowRate(from, to) {           // SOL of flow per second in [from, to)
      let vol = 0;
      for (const tr of ring) if (tr.t >= from && tr.t < to) vol += tr.quote;
      const span = Math.max(1, to - from);
      return vol / (span / 1000);
    }

    function refreshSignals(now) {
      /* buy/sell volume ratio + pressure trend over the tx window */
      const half = cfg.txWindowMs / 2;
      let buyR = 0, totR = 0, buyP = 0, totP = 0;
      for (const tr of ring) {
        if (tr.t <= now - cfg.txWindowMs) continue;
        const recent = tr.t > now - half;
        if (recent) { totR += tr.quote; if (tr.side === 'buy') buyR += tr.quote; }
        else { totP += tr.quote; if (tr.side === 'buy') buyP += tr.quote; }
      }
      const tot = totR + totP, buy = buyR + buyP;
      sig.buyVolRatio = tot > 0 ? buy / tot : 0.5;
      const ratioR = totR > 0 ? buyR / totR : 0.5;
      const ratioP = totP > 0 ? buyP / totP : 0.5;
      sig.pressureTrend = ratioR - ratioP;

      /* volume acceleration: recent flow rate vs the flow rate just before it */
      const recentMs = cfg.volBucketMs * cfg.volRecentBuckets;
      const baseMs = cfg.volBucketMs * cfg.volBaseBuckets;
      const recentRate = flowRate(now - recentMs, now);
      let baseRate;
      if (startT !== null && now - startT >= recentMs + cfg.volBucketMs) {
        baseRate = flowRate(Math.max(startT, now - recentMs - baseMs), now - recentMs);
      } else {
        baseRate = entryVolRate;             // too little history: entry-time baseline
      }
      sig.volAccel = baseRate > 1e-9 ? recentRate / baseRate : (recentRate > 0 ? 2 : 1);

      sig.velPctPerSec = (velEma || 0) * 100;
      sig.momentum = classify();
    }

    function classify() {
      const c = cfg, s = sig;
      if (s.velPctPerSec >= c.strongVelPctPerSec && s.buyVolRatio >= c.strongBuyRatio &&
          s.pressureTrend >= c.pressureRiseMin && s.volAccel >= c.strongVolAccel) return 'strong';
      if (s.velPctPerSec <= c.weakVelPctPerSec ||
          (s.buyVolRatio <= c.weakBuyRatio && s.pressureTrend <= c.pressureFallMax) ||
          (s.volAccel <= c.weakVolAccel && s.velPctPerSec <= 0)) return 'weak';
      return 'neutral';
    }

    function liqDropPct(now) {
      let max = 0, cur = null;
      for (const e of liqRing) {
        if (e.t <= now - cfg.liqPullWindowMs) continue;
        if (e.quote > max) max = e.quote;
        cur = e.quote;
      }
      if (max <= 0 || cur === null) return 0;
      return (max - cur) / max * 100;
    }

    function detectEmergency(now) {
      /* 1. liquidity pull */
      if (liqDropPct(now) >= cfg.liqPullPct) return 'EMERGENCY_LIQUIDITY_PULL';

      /* 2. whale dump: a big holder shedding a chunk of its bag, or any
       *    single wallet-attributed sell that is whale-scale vs the pool */
      const sellers = {};
      for (const tr of ring) {
        if (tr.side !== 'sell' || !tr.wallet || tr.t <= now - cfg.whaleWindowMs) continue;
        sellers[tr.wallet] = true;
        if (tr.poolQuote > 0 && (tr.quote / tr.poolQuote) * 100 >= cfg.whaleSellQuotePct) {
          return 'EMERGENCY_WHALE_DUMP';
        }
      }
      for (const w of Object.keys(sellers)) {
        const hist = pctRing[w];
        if (!hist || !hist.length) continue;
        const startPct = hist[0].pct;
        const isWhale = w === cfg.devWallet || startPct >= cfg.whaleHolderPct;
        if (!isWhale) continue;
        const curPct = curHolders[w] || 0;
        if (startPct > 0 && (startPct - curPct) / startPct >= cfg.whaleSellPortion) {
          return 'EMERGENCY_WHALE_DUMP';
        }
      }

      /* 3. contract risk: any risk flag flipped true this tick */
      if (lastTick && prevFlags) {
        for (const f of cfg.riskFlags) {
          if (!prevFlags[f] && lastTick.flags && lastTick.flags[f]) return 'EMERGENCY_CONTRACT_RISK';
        }
        /* 4. sell restriction: the flag flips... */
        if (!prevFlags.sellRestricted && lastTick.flags && lastTick.flags.sellRestricted) {
          return 'EMERGENCY_SELL_RESTRICTED';
        }
      }
      /* ...or the observed-flow honeypot heuristic: plenty of trades, zero
       * sells, where sells used to exist */
      if (sellsSeenEver) {
        let tx = 0, sells = 0;
        for (const tr of ring) {
          if (tr.t <= now - cfg.honeypotGapMs) continue;
          tx++; if (tr.side === 'sell') sells++;
        }
        if (tx >= cfg.honeypotMinTx && sells === 0) return 'EMERGENCY_SELL_RESTRICTED';
      }
      return null;
    }

    /* ------------------------------- public ------------------------------- */

    function onTick(tick) {
      const now = tick.t;
      if (startT === null) startT = now;

      if (prevPrice > 0 && tick.price > 0 && prevT !== null && now > prevT) {
        const rPerSec = Math.log(tick.price / prevPrice) * (1000 / (now - prevT));
        const alpha = 2 / (cfg.velEmaTicks + 1);
        velEma = velEma === null ? rPerSec : velEma + alpha * (rPerSec - velEma);
      }
      prevFlags = lastTick ? lastTick.flags : prevFlags;
      prevPrice = tick.price; prevT = now; lastTick = tick;

      for (const tr of tick.trades || []) {
        if (tr.wallet === cfg.selfWallet) continue;
        if (tr.side === 'sell') sellsSeenEver = true;
        ring.push({
          t: now, side: tr.side, quote: Number(tr.quote) || 0, wallet: tr.wallet || null,
          /* pool quote just before this sell left the pool (approx) */
          poolQuote: tick.pool ? tick.pool.quote + (tr.side === 'sell' ? (Number(tr.quote) || 0) : 0) : 0,
        });
      }
      prune(ring, now, ringMs);

      if (tick.pool) {
        liqRing.push({ t: now, quote: tick.pool.quote });
        prune(liqRing, now, cfg.liqPullWindowMs);
      }

      curHolders = {};
      for (const h of tick.holders || []) {
        curHolders[h.wallet] = h.pct;
        if (h.pct >= cfg.whaleHolderPct || h.wallet === cfg.devWallet) {
          (pctRing[h.wallet] = pctRing[h.wallet] || []).push({ t: now, pct: h.pct });
        }
      }
      for (const w of Object.keys(pctRing)) {
        prune(pctRing[w], now, cfg.whaleWindowMs);
        if (!pctRing[w].length) delete pctRing[w];
      }

      refreshSignals(now);
      if (entry && !closedReason && !emergency) emergency = detectEmergency(now);
    }

    function onEntry(e) {
      entry = { t: e.t, price: e.price, sizeBase: e.sizeBase };
      deadline = e.t + cfg.baseHoldMs;
      entryVolRate = flowRate(Math.max(startT || 0, e.t - ringMs), e.t);
    }

    function detail(now) {
      return {
        velPctPerSec: sig.velPctPerSec, buyVolRatio: sig.buyVolRatio,
        pressureTrend: sig.pressureTrend, volAccel: sig.volAccel, momentum: sig.momentum,
        impactPct: entry && lastTick ? sellImpactPct(lastTick.pool, entry.sizeBase) : 0,
        liqDropPct: liqDropPct(now),
        extensionsUsed: extensions.length, holdDeadline: deadline,
        heldMs: entry ? now - entry.t : 0,
        deferredMs: deferSince === null ? 0 : now - deferSince,
        split: false,
      };
    }

    /* Call once per tick, after onTick. Owns the hold deadline: EXTEND is
     * returned exactly once per extension; SELL_NOW latches. */
    function decide(now) {
      const d = detail(now);
      if (closedReason) return { action: 'SELL_NOW', reason: closedReason, detail: d };
      if (!entry) return { action: 'HOLD', reason: 'HOLDING', detail: d };

      /* 1. emergencies sell immediately — the impact gate is ignored, since
       *    when liquidity is going every ms of delay costs more than slippage */
      if (emergency) {
        closedReason = emergency;
        return { action: 'SELL_NOW', reason: emergency, detail: d };
      }

      /* discretionary exits: weak momentum, or the (possibly extended) timer */
      let want = null;
      if (now - entry.t >= cfg.minEvalMs && sig.momentum === 'weak') {
        want = 'WEAK_MOMENTUM';
      } else if (now >= deadline) {
        if (sig.momentum === 'strong' && deadline + cfg.extendStepMs <= entry.t + cfg.maxHoldMs) {
          deadline += cfg.extendStepMs;
          extensions.push({ t: now, newDeadline: deadline });
          const d2 = detail(now);
          return { action: 'EXTEND', reason: 'MOMENTUM_EXTEND', detail: d2 };
        }
        want = 'TIMER_EXPIRED';
      }

      if (want) {
        /* 2. liquidity protection: defer a discretionary sell while expected
         *    impact is extreme — but never for longer than impactDeferMaxMs */
        if (d.impactPct > cfg.maxImpactPct) {
          if (deferSince === null) deferSince = now;
          if (now - deferSince < cfg.impactDeferMaxMs) {
            return { action: 'HOLD', reason: 'IMPACT_DEFER', detail: detail(now) };
          }
        }
        closedReason = want;
        d.split = d.impactPct > cfg.splitImpactPct;
        return { action: 'SELL_NOW', reason: want, detail: d };
      }

      deferSince = null;
      return { action: 'HOLD', reason: 'HOLDING', detail: d };
    }

    function snapshot() { return detail(prevT === null ? 0 : prevT); }
    function getExtensions() { return extensions.slice(); }

    return { onTick, onEntry, decide, snapshot, extensions: getExtensions, cfg };
  }

  return { create, sellImpactPct, DEFAULT_CFG };
});
