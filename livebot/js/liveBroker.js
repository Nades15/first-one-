/* Livebot — LIVE broker. Spends real SOL. Same request/settle interface as the
 * paper broker so positions.js is single-path: request() kicks off the async
 * submit→sign→send→confirm→account flow and returns immediately; onTick()
 * drains fills that have confirmed since the last tick. The key is signed
 * LOCALLY (wallet.js) and never leaves this process.
 *
 * Only loaded in --live mode. @solana/web3.js is required lazily so paper mode
 * and the whole test suite never touch it. */
'use strict';

const { computeFees, round } = require('./broker.js');

const PUMP_TRADE_LOCAL = 'https://pumpportal.fun/api/trade-local';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS = 1e9;

function createLiveBroker(cfg, deps) {
  const { Connection, VersionedTransaction, PublicKey } = require('@solana/web3.js');
  const connection = new Connection(deps.rpcUrl, 'confirmed');
  const signer = deps.signer;
  const feeCfg = Object.assign({}, cfg.FEES, {
    priorityFeeSol: cfg.FEES.priorityFeeSol != null ? cfg.FEES.priorityFeeSol : cfg.TRADE.priorityFeeSol,
  });
  const T = cfg.TRADE;

  const settled = [];               // fills confirmed since the last onTick drain
  const inflight = new Set();       // mints with an order in flight (one at a time)
  let balanceCache = { at: 0, sol: null };
  let seq = 0;

  /* ---- PumpPortal local transaction: build → sign → send → confirm ---- */
  async function pumpTx(action, mint, amount, denominatedInSol, priorityFeeSol) {
    const resp = await fetch(PUMP_TRADE_LOCAL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publicKey: signer.pubkey, action, mint,
        amount, denominatedInSol: denominatedInSol ? 'true' : 'false',
        slippage: T.slippagePct, priorityFee: priorityFeeSol, pool: 'auto',
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      const graduated = /complete|migrat|raydium|amm/i.test(text);
      return { ok: false, failReason: graduated ? 'GRADUATED' : 'PUMP_BUILD_FAILED', detail: text.slice(0, 200) };
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    const tx = VersionedTransaction.deserialize(buf);
    signer.signTx(tx);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
    await connection.confirmTransaction(sig, 'confirmed');
    return { ok: true, sig };
  }

  /* Read the confirmed transaction and derive the real SOL/token deltas for
   * this wallet — record reality, not the quote. */
  async function accountDeltas(sig, mint) {
    const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.meta) return null;
    const keys = tx.transaction.message.getAccountKeys
      ? tx.transaction.message.getAccountKeys().staticAccountKeys
      : tx.transaction.message.accountKeys;
    const meIdx = keys.findIndex(k => k.toBase58() === signer.pubkey);
    const solDelta = meIdx >= 0 ? (tx.meta.postBalances[meIdx] - tx.meta.preBalances[meIdx]) / LAMPORTS : 0;
    const tokenOf = (arr) => {
      const row = (arr || []).find(b => b.mint === mint && b.owner === signer.pubkey);
      return row ? Number(row.uiTokenAmount.amount) : 0;
    };
    const tokenDelta = tokenOf(tx.meta.postTokenBalances) - tokenOf(tx.meta.preTokenBalances);
    return { solDelta, tokenDelta };
  }

  async function submitBuy(orderId, mint, solIn) {
    let attempt = await pumpTx('buy', mint, solIn, true, feeCfg.priorityFeeSol);
    if (!attempt.ok) attempt = await pumpTx('buy', mint, solIn, true, feeCfg.priorityFeeSol * T.priorityBumpMult);
    if (!attempt.ok) return push(orderId, 'buy', mint, { ok: false, t: 0, failReason: attempt.failReason });
    const d = await accountDeltas(attempt.sig, mint) || { solDelta: -solIn, tokenDelta: 0 };
    const baseOut = d.tokenDelta;
    const solSpent = Math.abs(d.solDelta);
    push(orderId, 'buy', mint, {
      ok: baseOut > 0, t: 0, baseOut, solSpent: round(solSpent, 9),
      execPrice: baseOut > 0 ? solSpent / baseOut : 0, fees: computeFees(solIn, feeCfg), sig: attempt.sig,
      failReason: baseOut > 0 ? undefined : 'NO_FILL',
    });
  }

  async function submitSell(orderId, mint, baseIn, ctx) {
    const deadline = Date.now() + T.sellAbandonMs;
    let attempt = null;
    let prio = feeCfg.priorityFeeSol;
    while (Date.now() < deadline) {
      attempt = await pumpTx('sell', mint, Math.floor(baseIn), false, prio);
      if (attempt.ok) break;
      if (attempt.failReason === 'GRADUATED') { attempt = await gradSell(mint, baseIn); if (attempt.ok) break; }
      prio *= T.priorityBumpMult;
      await sleep(T.sellRetryMs);
    }
    if (!attempt || !attempt.ok) {
      return push(orderId, 'sell', mint, { ok: false, t: 0, failReason: (attempt && attempt.failReason) || 'SELL_ABANDONED', fees: computeFees(0, feeCfg), impactPct: 0 });
    }
    const d = await accountDeltas(attempt.sig, mint) || { solDelta: 0, tokenDelta: -baseIn };
    const solOutGross = Math.max(0, d.solDelta) + feeCfg.priorityFeeSol; // delta already net of priority
    const fees = computeFees(solOutGross, feeCfg);
    push(orderId, 'sell', mint, {
      ok: true, t: 0, solOutNet: round(Math.max(0, d.solDelta), 9),
      impactPct: 0, execPrice: baseIn > 0 ? Math.max(0, d.solDelta) / baseIn : 0, fees, sig: attempt.sig,
    });
  }

  async function gradSell(mint, baseIn) {
    const jup = require('./jupiter.js');
    try {
      return await jup.sellForSol({ connection, signer, mint, tokenAmount: baseIn,
        slippageBps: T.slippagePct * 100, priorityFeeSol: feeCfg.priorityFeeSol });
    } catch (e) { return { ok: false, failReason: 'JUPITER_ERROR' }; }
  }

  function push(orderId, kind, mint, res) {
    res.orderId = orderId; res.kind = kind; res.mint = mint;
    inflight.delete(mint);
    settled.push(res);
  }

  /* ------------------------------ interface ------------------------------ */
  function request(kind, mint, size, ctx) {
    const orderId = ++seq;
    inflight.add(mint);
    const run = kind === 'buy' ? submitBuy(orderId, mint, size)
      : submitSell(orderId, mint, size, ctx);
    run.catch(e => push(orderId, kind, mint, { ok: false, t: 0, failReason: 'EXCEPTION', detail: String(e).slice(0, 120), fees: computeFees(0, feeCfg), impactPct: 0 }));
    return orderId;
  }

  function onTick(mint, tick) {
    if (!settled.length) return [];
    const out = [];
    for (let i = settled.length - 1; i >= 0; i--) {
      if (settled[i].mint === mint) { settled[i].t = tick.t; out.push(settled.splice(i, 1)[0]); }
    }
    return out;
  }

  async function getBalanceSol() {
    const { PublicKey } = require('@solana/web3.js');
    const lamports = await connection.getBalance(new PublicKey(signer.pubkey));
    balanceCache = { at: Date.now(), sol: lamports / LAMPORTS };
    return balanceCache.sol;
  }
  function cachedBalanceSol() { return balanceCache.sol; }

  async function rpc(method, params) {
    const resp = await fetch(deps.rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await resp.json();
    return j.result;
  }

  return { request, onTick, getBalanceSol, cachedBalanceSol, rpc, mode: 'live', kind: 'live' };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { createLiveBroker };
