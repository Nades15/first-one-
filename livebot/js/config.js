/* Livebot — all tunable thresholds in one place (Pulse-style). Runtime
 * overrides in data/settings.json are merged over this at startup. */
'use strict';

const SXExit = require('../../scalper/js/exit.js');

const CONFIG = {
  /* ------------------------------ market feed ----------------------------- */
  /* Data comes from the pump.fun program's logs over a free Helius websocket
   * (logsSubscribe consumes no credits). The ws URL is derived at runtime from
   * HELIUS_RPC_URL (https -> wss). */
  FEED: {
    pumpProgramId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    commitment: 'processed',     // fastest; we want to see trades ASAP
    tickMs: 250,                 // engine tick cadence (matches the sim)
    reconnectMinMs: 500,
    reconnectMaxMs: 8000,
    staleMsgMs: 5000,            // no ws message this long ⇒ treat socket as dead
    disconnectGraceMs: 1500,     // ...then, if holding, best-effort sell-all (FEED_LOST)
    holderPollMs: 2000,          // getTokenLargestAccounts cadence, per OPEN position only
    holderPollEnabled: true,
    maxWatchedTokens: 8,         // launch candidates tracked at once (evict oldest undecided)
    supply: 1e9,                 // pump.fun standard token supply
  },

  /* ----------------------------- entry filters ---------------------------- */
  /* Unproven — this is what paper mode + skip-shadowing exist to calibrate. */
  SNIPER: {
    decideAfterMs: 2500,         // wait this long after launch before judging flow
    giveUpMs: 8000,              // no ENTER by here ⇒ SKIP
    devBuyMinSol: 0.3,           // dev's own initial buy must be in this range
    devBuyMaxSol: 5,
    requireName: true,           // reject nameless/symbol-less launches
    requireSocials: false,       // fetch metadata uri and require a social link (latency/flaky — off)
    minUniqueBuyers: 4,
    minNetInflowSol: 1.0,        // net (buys - sells) SOL into the curve
    maxDevHoldPct: 20,           // dev holding above this ⇒ skip
    minCurveSol: 31,             // curve vSol band: not brand-new, not already pumped past us
    maxCurveSol: 45,
    shadowMs: 60000,             // keep watching skipped launches this long → skips.jsonl
  },

  /* ------------------------------- trading -------------------------------- */
  TRADE: {
    buySol: 0.05,                // position size (RISK.perTradeCapSol is the hard ceiling)
    slippagePct: 10,             // live order slippage tolerance
    priorityFeeSol: 0.0003,      // Solana priority fee per tx
    priorityBumpMult: 1.5,       // retry a failed tx with this much more priority
    paperLatencyMs: 400,         // paper fills execute against pool state this far ahead (honest lag)
    sellRetryMs: 2000,           // live: re-attempt a failed sell this often...
    sellAbandonMs: 30000,        // ...until this long, then WRITTEN_OFF
    maxPositionAgeMs: 60000,     // belt-and-braces force-sell regardless of engine state
    sellOnGraduation: true,      // exit immediately if the token migrates off the curve mid-hold
  },

  /* --------------------------------- fees --------------------------------- */
  /* Charged in BOTH paper and live so the stats gate measures NET edge.
   * Reality check at the 0.05 SOL size: the 3% percentage fees PLUS the flat
   * priority fee (~0.6%/side at this size) make a flat round trip cost ~4.5%.
   * The average winner must clear ~4.5% before the position is net positive. */
  FEES: {
    pumpFeePct: 1.0,             // pump.fun protocol fee, per side
    portalFeePct: 0.5,           // PumpPortal fee, per side
    networkFeeSol: 0.000005,     // Solana base fee per tx
  },

  /* ------------------------------ risk caps ------------------------------- */
  /* perTradeCapSol is ALSO enforced as a frozen 0.05 ceiling in risk.js —
   * lowering it here works; raising it above 0.05 does nothing in live mode. */
  RISK: {
    perTradeCapSol: 0.05,
    maxConcurrent: 3,
    dailyStopSol: 0.15,          // cumulative net loss for the UTC day ⇒ halt sniping
    gateMinTrades: 50,           // paper trades required before live can arm
    minWalletFloorSol: 0.05,     // keep at least this in the wallet (fees/rent/exit gas)
  },

  /* ------------------------------ dashboard ------------------------------- */
  SERVER: { port: 8787, host: '127.0.0.1' },

  /* ------------------------- smart-exit thresholds ------------------------ */
  /* Reused verbatim from the Pulse engine. IMPORTANT: these were tuned on the
   * SYNTHETIC simulator. Live pump.fun flow is faster and spikier — treat
   * them as starting points and recalibrate from recorded sessions via
   * `node livebot --replay`. Every value here is overridable in settings.json. */
  EXIT: Object.assign({}, SXExit.DEFAULT_CFG),
};

/* Deep-ish merge of data/settings.json overrides over the defaults above. */
function withOverrides(base, over) {
  if (!over) return base;
  const out = {};
  for (const k of Object.keys(base)) {
    const b = base[k], o = over[k];
    out[k] = (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object')
      ? Object.assign({}, b, o) : (o !== undefined ? o : b);
  }
  return out;
}

module.exports = { CONFIG, withOverrides };
