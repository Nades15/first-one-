/* Pulse — deterministic market simulator: a constant-product AMM pool plus a
 * seeded population of wallets trading through it. No DOM, no clocks, no
 * Math.random — same seed + scenario means a byte-identical tick stream, so
 * it runs in node for tests (scalper/test/) and in the browser as
 * window.SXSim. Price impact is emergent: every buy/sell (including the
 * paper trader's own orders) routes through the pool. */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SXSim = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* mulberry32 — tiny seeded PRNG, plenty for market noise. */
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------- constant-product AMM ------------------------- */
  /* pool = { base, quote }: token reserve and SOL reserve. spot = quote/base.
   * buy/sell mutate the pool and return the amount received. */
  const amm = {
    buy(pool, quoteIn) {                       // spend quote, receive base
      const baseOut = pool.base * quoteIn / (pool.quote + quoteIn);
      pool.quote += quoteIn;
      pool.base -= baseOut;
      return baseOut;
    },
    sell(pool, baseIn) {                       // spend base, receive quote
      const quoteOut = pool.quote * baseIn / (pool.base + baseIn);
      pool.base += baseIn;
      pool.quote -= quoteOut;
      return quoteOut;
    },
    /* Expected % below spot a sell of baseIn would execute at (pure). */
    impactPct(pool, baseIn) {
      if (!(baseIn > 0) || !(pool.base > 0)) return 0;
      return (baseIn / (pool.base + baseIn)) * 100;
    },
  };

  /* ------------------------------ scenarios ------------------------------ */
  /* phases: [{ durMs, tps, buyProb, sizeMult }] — background flow intensity.
   * events: scripted shocks. Types:
   *   { at, type: 'pullLiquidity', pct }                       LP rug
   *   { at, type: 'whaleSell', wallet, portion, spreadTicks }  big holder dumps
   *   { at, type: 'setFlag', flag, value }                     contract risk flips
   * Timings assume the trader enters at ~1s and a fixed 4s baseline exits at
   * ~5s — shocks land between the smart engine's reaction window and the
   * baseline's sale so the comparison is meaningful. */
  const SCENARIOS = {
    pumpFade: {
      label: 'Pump then fade',
      blurb: 'Heavy buying for 8s, then interest dries up and sellers take over.',
      phases: [
        { durMs: 8000, tps: 10, buyProb: 0.80, sizeMult: 1 },
        { durMs: 4000, tps: 8, buyProb: 0.50, sizeMult: 1 },
        { durMs: 15000, tps: 8, buyProb: 0.30, sizeMult: 1.2 },
      ],
      events: [],
    },
    moonshot: {
      label: 'Moonshot',
      blurb: 'Sustained, accelerating buy pressure — the hold-extension showcase.',
      phases: [
        { durMs: 3000, tps: 8, buyProb: 0.75, sizeMult: 1 },
        { durMs: 5000, tps: 12, buyProb: 0.80, sizeMult: 1.3 },
        { durMs: 17000, tps: 16, buyProb: 0.85, sizeMult: 1.6 },
      ],
      events: [],
    },
    slowBleed: {
      label: 'Slow bleed',
      blurb: 'Sell-dominant from the start — the instant weak-momentum exit showcase.',
      phases: [
        { durMs: 25000, tps: 8, buyProb: 0.28, sizeMult: 1.3 },
      ],
      events: [],
    },
    rugPull: {
      label: 'Rug pull',
      blurb: '95% of liquidity yanked at 4.5s, dev dumps right after.',
      phases: [
        { durMs: 27000, tps: 9, buyProb: 0.65, sizeMult: 1 },
      ],
      events: [
        { at: 4500, type: 'pullLiquidity', pct: 0.95 },
        { at: 4750, type: 'whaleSell', wallet: 'dev', portion: 0.9, spreadTicks: 2 },
      ],
    },
    whaleDump: {
      label: 'Whale dump',
      blurb: 'Healthy pump until a top holder unloads 80% of their bag at 3.5s.',
      phases: [
        { durMs: 5000, tps: 10, buyProb: 0.78, sizeMult: 1.2 },
        { durMs: 20000, tps: 8, buyProb: 0.45, sizeMult: 1 },
      ],
      events: [
        { at: 3500, type: 'whaleSell', wallet: 'whale1', portion: 0.8, spreadTicks: 4 },
      ],
    },
    honeypot: {
      label: 'Honeypot',
      blurb: 'Looks like a pump — then selling is switched off at 4s.',
      phases: [
        { durMs: 4000, tps: 9, buyProb: 0.70, sizeMult: 1 },
        { durMs: 21000, tps: 9, buyProb: 1.0, sizeMult: 1 },
      ],
      events: [
        { at: 4000, type: 'setFlag', flag: 'sellRestricted', value: true },
      ],
    },
    chop: {
      label: 'Chop',
      blurb: 'Sideways noise, no events — the timer should simply fire at 4s.',
      phases: [
        { durMs: 25000, tps: 8, buyProb: 0.50, sizeMult: 0.6 },
      ],
      events: [],
    },
  };

  const SCENARIO_IDS = Object.keys(SCENARIOS);

  const DEFAULTS = {
    supply: 1e9,
    initQuoteSol: 100,
    poolShare: 0.5,
    minTradeSol: 0.02,
    maxTradeMult: 40,
    retailWallets: 60,
  };

  /* ------------------------------ simulator ------------------------------ */
  function createSim(opts) {
    const scenario = SCENARIOS[opts.scenario];
    if (!scenario) throw new Error('unknown scenario: ' + opts.scenario);
    const cfg = Object.assign({}, DEFAULTS, opts.sim || {});
    const tickMs = opts.tickMs || 250;
    const rng = makeRng(Number(opts.seed) || 1);

    const totalDurMs = scenario.phases.reduce((s, p) => s + p.durMs, 0);

    /* Wallet population. The pool holds poolShare of supply; dev and whales
     * get seeded bags (whales always above the 4% detector threshold so
     * whale-dump scenarios are unambiguous); retail splits the rest. */
    const balances = {};                       // wallet -> base tokens held
    const wallets = [];                        // tradable (non-dev) wallet ids
    let freeSupply = cfg.supply * (1 - cfg.poolShare);

    const devBag = cfg.supply * (0.10 + rng() * 0.08);        // 10–18%
    balances.dev = devBag; freeSupply -= devBag;

    const whaleCount = 2 + Math.floor(rng() * 3);             // 2–4
    for (let i = 1; i <= whaleCount; i++) {
      const bag = cfg.supply * (0.045 + rng() * 0.025);       // 4.5–7%
      balances['whale' + i] = bag; freeSupply -= bag;
      wallets.push('whale' + i);
    }

    const retailBag = Math.max(0, freeSupply) / cfg.retailWallets;
    for (let i = 1; i <= cfg.retailWallets; i++) {
      balances['w' + i] = retailBag;
      wallets.push('w' + i);
    }

    const pool = { base: cfg.supply * cfg.poolShare, quote: cfg.initQuoteSol };
    const flags = { sellRestricted: false, mintEnabled: false, lpUnlocked: false, blacklistRisk: false };

    let t = 0;
    let pendingYou = [];                       // execute() trades since last tick
    const dumps = [];                          // active whaleSell drips
    const eventsLeft = scenario.events.slice();
    let lastTick = null;

    function phaseAt(ms) {
      let acc = 0;
      for (const p of scenario.phases) {
        acc += p.durMs;
        if (ms < acc) return p;
      }
      return scenario.phases[scenario.phases.length - 1];
    }

    /* Sell from a wallet through the pool, capped at its balance. */
    function walletSell(wallet, baseIn, trades) {
      const avail = balances[wallet] || 0;
      const size = Math.min(avail, baseIn);
      if (!(size > 0)) return;
      balances[wallet] = avail - size;
      const quoteOut = amm.sell(pool, size);
      trades.push({ side: 'sell', base: size, quote: quoteOut, wallet });
    }

    function walletBuy(wallet, quoteIn, trades) {
      if (!(quoteIn > 0)) return;
      const baseOut = amm.buy(pool, quoteIn);
      balances[wallet] = (balances[wallet] || 0) + baseOut;
      trades.push({ side: 'buy', base: baseOut, quote: quoteIn, wallet });
    }

    function topHolders() {
      const rows = Object.keys(balances)
        .map(w => ({ wallet: w, pct: balances[w] / cfg.supply * 100 }))
        .filter(h => h.pct > 0.0001);
      rows.sort((a, b) => b.pct - a.pct);
      return rows.slice(0, 10);
    }

    function applyEvents(trades) {
      for (let i = eventsLeft.length - 1; i >= 0; i--) {
        const ev = eventsLeft[i];
        if (ev.at > t) continue;
        eventsLeft.splice(i, 1);
        if (ev.type === 'pullLiquidity') {
          pool.base *= (1 - ev.pct);
          pool.quote *= (1 - ev.pct);
        } else if (ev.type === 'setFlag') {
          flags[ev.flag] = ev.value;
        } else if (ev.type === 'whaleSell') {
          const ticks = Math.max(1, ev.spreadTicks || 4);
          const perTick = (balances[ev.wallet] || 0) * ev.portion / ticks;
          dumps.push({ wallet: ev.wallet, perTick, ticksLeft: ticks });
        }
      }
      for (let i = dumps.length - 1; i >= 0; i--) {
        const d = dumps[i];
        walletSell(d.wallet, d.perTick, trades);
        if (--d.ticksLeft <= 0) dumps.splice(i, 1);
      }
    }

    function backgroundFlow(trades) {
      const p = phaseAt(t);
      const expected = p.tps * tickMs / 1000;
      let count = Math.floor(expected);
      if (rng() < expected - count) count++;
      for (let i = 0; i < count; i++) {
        const buying = rng() < p.buyProb;
        const quoteSize = cfg.minTradeSol * Math.pow(cfg.maxTradeMult, rng()) * p.sizeMult;
        const wallet = wallets[Math.floor(rng() * wallets.length)];
        if (buying) {
          walletBuy(wallet, quoteSize, trades);
        } else if (!flags.sellRestricted) {    // honeypot: nobody can sell
          const price = pool.quote / pool.base;
          walletSell(wallet, quoteSize / price, trades);
        }
      }
    }

    function next() {
      t += tickMs;
      const trades = pendingYou;
      pendingYou = [];
      applyEvents(trades);
      backgroundFlow(trades);
      lastTick = {
        t,
        price: pool.quote / pool.base,
        trades,
        pool: { base: pool.base, quote: pool.quote },
        holders: topHolders(),
        flags: Object.assign({}, flags),
      };
      return lastTick;
    }

    /* The paper trader's own orders hit the live pool and appear in the NEXT
     * tick's trade list — the market "sees" us. Returns execution details. */
    function execute(order) {
      const wallet = order.wallet || 'you';
      if (order.side === 'buy') {
        const quoteIn = Number(order.quoteIn) || 0;
        const spot = pool.quote / pool.base;
        const baseOut = amm.buy(pool, quoteIn);
        balances[wallet] = (balances[wallet] || 0) + baseOut;
        pendingYou.push({ side: 'buy', base: baseOut, quote: quoteIn, wallet });
        return { ok: true, baseOut, quoteIn, execPrice: quoteIn / baseOut, spot };
      }
      if (flags.sellRestricted) return { ok: false, reason: 'SELL_RESTRICTED' };
      const avail = balances[wallet] || 0;
      const baseIn = Math.min(avail, Number(order.baseIn) || 0);
      if (!(baseIn > 0)) return { ok: false, reason: 'NO_BALANCE' };
      const spot = pool.quote / pool.base;
      const impactPct = amm.impactPct(pool, baseIn);
      const quoteOut = amm.sell(pool, baseIn);
      balances[wallet] = avail - baseIn;
      pendingYou.push({ side: 'sell', base: baseIn, quote: quoteOut, wallet });
      return { ok: true, baseIn, quoteOut, execPrice: quoteOut / baseIn, spot, impactPct };
    }

    function snapshot() { return lastTick; }
    function done() { return t >= totalDurMs; }

    return { next, snapshot, execute, done, tickMs };
  }

  return { makeRng, amm, createSim, SCENARIOS, SCENARIO_IDS, DEFAULTS };
});
