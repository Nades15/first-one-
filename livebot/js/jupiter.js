/* Livebot — Jupiter swap fallback, EXIT ONLY. Used to sell a position whose
 * token has graduated off the pump.fun bonding curve (migrated to PumpSwap/
 * Raydium) mid-hold, when PumpPortal's trade-local can't route it. We never
 * ENTER graduated tokens this way. Live-only; @solana/web3.js is required
 * lazily so paper mode and tests never load it. */
'use strict';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const QUOTE_URL = 'https://quote-api.jup.ag/v6/quote';
const SWAP_URL = 'https://quote-api.jup.ag/v6/swap';

/* Sell `tokenAmount` base units of `mint` for SOL. Returns { ok, sig, ... }. */
async function sellForSol(opts) {
  const { VersionedTransaction } = require('@solana/web3.js');
  const { connection, signer, mint, tokenAmount, slippageBps, priorityFeeSol } = opts;

  const q = new URL(QUOTE_URL);
  q.searchParams.set('inputMint', mint);
  q.searchParams.set('outputMint', SOL_MINT);
  q.searchParams.set('amount', String(Math.floor(tokenAmount)));
  q.searchParams.set('slippageBps', String(slippageBps || 1000));
  const quote = await (await fetch(q)).json();
  if (!quote || !quote.outAmount) return { ok: false, failReason: 'JUPITER_NO_ROUTE' };

  const swapResp = await fetch(SWAP_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: signer.pubkey,
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: Math.round((priorityFeeSol || 0) * 1e9) || 'auto',
    }),
  });
  const swap = await swapResp.json();
  if (!swap || !swap.swapTransaction) return { ok: false, failReason: 'JUPITER_SWAP_BUILD_FAILED' };

  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
  signer.signTx(tx);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
  await connection.confirmTransaction(sig, 'confirmed');
  return { ok: true, sig, outLamports: Number(quote.outAmount) };
}

module.exports = { sellForSol, SOL_MINT };
