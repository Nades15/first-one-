/* Livebot — broker interface + shared fee model.
 *
 * Both PaperBroker and LiveBroker implement:
 *   async buy(mint, solIn, ctx)  -> { ok, t, baseOut, solSpent, execPrice, fees, sig|null, failReason? }
 *   async sell(mint, baseIn, ctx) -> { ok, t, solOutNet, execPrice, impactPct, fees, sig|null, failReason? }
 * where ctx = { tick, devWallet } and fees is itemized in SOL:
 *   { platform, portal, priority, network, total }
 *
 * Fees are charged identically in both brokers so the stats gate measures a
 * NET edge, not a gross one. A flat-price round trip loses ~3.1% to fees. */
'use strict';

/* Itemized fees for trading `solAmount` SOL of notional. platform/portal are
 * percentage-of-notional (charged per side); priority/network are flat per tx. */
function computeFees(solAmount, feeCfg) {
  const platform = solAmount * (feeCfg.pumpFeePct / 100);
  const portal = solAmount * (feeCfg.portalFeePct / 100);
  const priority = feeCfg.priorityFeeSol || 0;
  const network = feeCfg.networkFeeSol || 0;
  return {
    platform: round(platform, 9), portal: round(portal, 9),
    priority: round(priority, 9), network: round(network, 9),
    total: round(platform + portal + priority + network, 9),
  };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { computeFees, round };
