/* Hand-built PumpPortal messages mirroring the documented schema. Used by
 * feed and pipeline tests — no network. */
'use strict';

const LAUNCH = {
  signature: 'sig-create', mint: 'MINT1', traderPublicKey: 'DEV',
  txType: 'create', name: 'Test Token', symbol: 'TEST', uri: 'ipfs://x',
  initialBuy: 30e6, solAmount: 1.0,
  vTokensInBondingCurve: 1.043e9, vSolInBondingCurve: 31.0, marketCapSol: 32,
};

function trade(over) {
  return Object.assign({
    signature: 'sig', mint: 'MINT1', traderPublicKey: 'W1', txType: 'buy',
    tokenAmount: 1e6, solAmount: 0.03, newTokenBalance: 1e6,
    vTokensInBondingCurve: 1.04e9, vSolInBondingCurve: 31.03, marketCapSol: 32,
  }, over);
}

module.exports = { LAUNCH, trade };
