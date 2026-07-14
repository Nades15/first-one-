/* Fairline — all tunable thresholds in one place (Livebot-style). Runtime
 * overrides in data/settings.json are merged over this at startup.
 *
 * The strategy: for a short-horizon crypto market ("BTC above $118,000 at
 * 5 PM?"), a drift-free fair probability follows from live spot + realized
 * volatility. When the executable book price sits further from that fair
 * line than spread + fees + minEdge, the gap is paper-traded and settled at
 * resolution. Every threshold here is a hypothesis — paper mode exists to
 * measure them, and replay exists to re-test them on recorded sessions. */
'use strict';

const CONFIG = {
  /* ------------------------------ spot feed ------------------------------- */
  /* Coinbase Exchange is primary (keyless, no geo wall); Binance is the
   * fallback. Both stream trades; fairline samples a price once per sampleMs
   * and feeds the EWMA vol estimator. */
  SPOT: {
    primary: 'coinbase',           // 'coinbase' | 'binance'
    coinbaseUrl: 'wss://ws-feed.exchange.coinbase.com',
    binanceUrl: 'wss://stream.binance.com:9443/stream',
    assets: {
      BTC: { coinbase: 'BTC-USD', binance: 'btcusdt' },
      ETH: { coinbase: 'ETH-USD', binance: 'ethusdt' },
      SOL: { coinbase: 'SOL-USD', binance: 'solusdt' },
    },
    sampleMs: 1000,                // one recorded/vol sample per second per asset
    volHalfLifeMs: 10 * 60e3,      // EWMA half-life for realized vol (10 min)
    minVolSamples: 60,             // no fair pricing until the estimator has this many samples
    staleMsgMs: 15000,             // no ws message this long ⇒ socket treated as dead
    reconnectMinMs: 500,
    reconnectMaxMs: 8000,
  },

  /* --------------------------- market discovery --------------------------- */
  DISCOVERY: {
    polymarket: true,
    kalshi: true,
    refreshMs: 60e3,               // re-sweep both platforms this often
    horizonMs: 6 * 3600e3,         // only watch markets resolving within 6h
    maxMarkets: 12,                // watch at most this many (soonest-closing first)
    polymarketApi: 'https://gamma-api.polymarket.com',
    clobApi: 'https://clob.polymarket.com',
    kalshiApis: [                  // same hosts Scout uses (scanner/js/config.js)
      'https://api.elections.kalshi.com/trade-api/v2',
      'https://external-api.kalshi.com/trade-api/v2',
    ],
    updownWindowMs: 3600e3,        // hourly up-or-down series window length
  },

  /* ------------------------------ order books ----------------------------- */
  BOOKS: {
    pollMs: 2500,                  // per watched market book refresh cadence
    staleMs: 20000,                // book older than this ⇒ market not tradable
    minDepthContracts: 20,         // best-level depth required before entering
  },

  /* ------------------------------- strategy ------------------------------- */
  /* minEdge is in probability points NET of fees: fair 0.62 vs ask 0.55 with
   * 0.01 fees is a 0.06 net edge. The tau guards skip markets so close to
   * resolution that the model is all noise, and so far out that vol scaling
   * from a 10-minute window is meaningless. */
  STRATEGY: {
    minEdge: 0.05,                 // net edge (prob points) required to enter
    minTauSec: 120,                // don't enter within 2 min of close
    maxTauSec: 6 * 3600,           // don't price beyond the discovery horizon
    exitFlipEdge: 0.05,            // early exit when the book over-prices our side by this
    cooldownMs: 60e3,              // per-market pause after any fill
    maxPerMarket: 1,               // one open position per market
  },

  /* -------------------------------- trading ------------------------------- */
  TRADE: {
    sizeUsd: 10,                   // target stake per position (RISK cap is the ceiling)
    paperLatencyMs: 1500,          // fills execute against the book seen this far AFTER the decision
  },

  /* --------------------------------- fees --------------------------------- */
  /* Charged in paper so the gate measures NET edge. Kalshi's published taker
   * fee is ceil(0.07 · C · P · (1−P)) per fill; Polymarket currently charges
   * no trading fee on these markets — the honest cost there is crossing the
   * spread, which the broker pays by walking the real book. */
  FEES: {
    kalshiFeeRate: 0.07,
    polymarketFeePct: 0,           // % of notional, per side (0 today; knob for later)
  },

  /* ------------------------------ risk caps ------------------------------- */
  RISK: {
    perTradeCapUsd: 10,            // hard ceiling on stake (config can lower, never raise)
    maxConcurrent: 5,
    dailyStopUsd: 30,              // cumulative net loss for the UTC day ⇒ halt entries
    gateMinTrades: 100,            // settled paper trades before live is even a conversation
  },

  /* ------------------------------- dashboard ------------------------------ */
  SERVER: { port: 8788, host: '127.0.0.1' },   // livebot owns 8787

  /* --------------------------------- engine ------------------------------- */
  ENGINE: { tickMs: 1000 },
};

/* Deep-ish merge of data/settings.json overrides over the defaults above
 * (same shape as livebot/js/config.js withOverrides). */
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
