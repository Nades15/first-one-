/* Livebot — market feed adapter (Helius). Subscribes to the pump.fun program's
 * logs over a free Helius websocket (logsSubscribe consumes no credits), decodes
 * the on-chain CreateEvent/TradeEvent from the `Program data:` log lines, and
 * emits them in the exact normalized shapes the rest of the bot consumes — so
 * the TickBuilder, sniper, engine, recorder and replay are all unchanged.
 *
 * A single logsSubscribe to the program delivers EVERY launch and trade on the
 * bonding curve; the pipeline only acts on mints it's tracking. No PumpPortal,
 * no per-message SOL cost. Amounts on-chain are lamports / 6-decimal base
 * units; we normalize to whole SOL / whole tokens here.
 *
 * Normalized shapes (identical to the previous PumpPortal adapter):
 *   { kind:'launch', mint, creator, name, symbol, uri, devBuySol, devBuyTokens,
 *     vSol, vTokens, sig, recvT }
 *   { kind:'trade', mint, side, wallet, sol, tokens, walletNewBalance:null,
 *     vSol, vTokens, sig, recvT } */
'use strict';

const { decodeEvent, PUMP_PROGRAM_ID } = require('./pumpEvents.js');

const LAMPORTS = 1e9;
const TOKEN_DECIMALS = 1e6;
const INIT_VSOL = 30;                 // pump.fun bonding-curve initial virtual reserves,
const INIT_VTOKENS = 1_073_000_000;   // used only if a launch has no paired dev buy

const num = v => { const n = Number(v); return isFinite(n) ? n : NaN; };
const str = v => (v == null ? '' : String(v));

/* ----------------------- Helius log → messages ------------------------ */

function tradeMsg(e, recvT, sig) {
  return {
    kind: 'trade', recvT, mint: e.mint, side: e.isBuy ? 'buy' : 'sell', wallet: e.user,
    sol: e.solLamports / LAMPORTS, tokens: e.tokenBase / TOKEN_DECIMALS,
    walletNewBalance: null,           // not in TradeEvent; TickBuilder keeps a running balance
    vSol: e.vSolLamports / LAMPORTS, vTokens: e.vTokensBase / TOKEN_DECIMALS, sig,
  };
}

/* Decode one Helius logsNotification into 0+ normalized messages. A token's
 * creation transaction carries the CreateEvent AND the dev's initial buy in the
 * same logs, so we fold the dev buy into the launch (and don't double-count it
 * as a trade). Failed transactions (value.err) are skipped. */
function decodeNotification(raw, recvT) {
  const val = raw && raw.params && raw.params.result && raw.params.result.value;
  if (!val || val.err || !Array.isArray(val.logs)) return [];
  const sig = str(val.signature);
  const events = [];
  for (const line of val.logs) {
    if (typeof line !== 'string' || !line.startsWith('Program data: ')) continue;
    const ev = decodeEvent(line.slice(14));       // 'Program data: '.length === 14
    if (ev) events.push(ev);
  }
  if (!events.length) return [];

  const out = [];
  const create = events.find(e => e.type === 'create');
  if (create) {
    const devTrade = events.find(e => e.type === 'trade' && e.user === create.user && e.isBuy);
    out.push({
      kind: 'launch', recvT, mint: create.mint, creator: create.user,
      name: create.name, symbol: create.symbol, uri: create.uri,
      vSol: devTrade ? devTrade.vSolLamports / LAMPORTS : INIT_VSOL,
      vTokens: devTrade ? devTrade.vTokensBase / TOKEN_DECIMALS : INIT_VTOKENS,
      devBuySol: devTrade ? devTrade.solLamports / LAMPORTS : 0,
      devBuyTokens: devTrade ? devTrade.tokenBase / TOKEN_DECIMALS : 0,
      sig,
    });
    for (const e of events) if (e.type === 'trade' && e !== devTrade) out.push(tradeMsg(e, recvT, sig));
  } else {
    for (const e of events) if (e.type === 'trade') out.push(tradeMsg(e, recvT, sig));
  }
  return out;
}

/* ----------------------------- TickBuilder ----------------------------- */

/* One per watched mint. Fold normalized messages in with note(); emit an
 * engine tick with flush(t). Holders are derived from the trade stream:
 * TradeEvents carry no absolute balance, so we keep a running per-wallet total
 * (dev seeded from the launch), corrected periodically by the RPC poller. */
function createTickBuilder(opts) {
  const supply = (opts && opts.supply) || 1e9;
  const selfWallet = opts && opts.selfWallet;
  const devWallet = opts && opts.devWallet;

  const balances = new Map();                       // wallet -> tokens
  let pending = [];                                 // trades since last flush
  let lastPool = null;                              // { base, quote }
  let lastPrice = 0;
  let rpcHolders = null;                            // corrector from RPC, or null
  const flags = { sellRestricted: false, mintEnabled: false, lpUnlocked: false, blacklistRisk: false };

  function seedLaunch(msg) {
    if (msg.creator && msg.devBuyTokens > 0) balances.set(msg.creator, msg.devBuyTokens);
    lastPool = { base: msg.vTokens, quote: msg.vSol };
    lastPrice = msg.vTokens > 0 ? msg.vSol / msg.vTokens : 0;
  }

  function note(msg) {
    if (msg.kind === 'launch') { seedLaunch(msg); return; }
    if (msg.kind !== 'trade') return;
    pending.push({ side: msg.side, base: msg.tokens, quote: msg.sol, wallet: msg.wallet });
    if (msg.wallet) {
      if (msg.walletNewBalance !== null && msg.walletNewBalance !== undefined) {
        balances.set(msg.wallet, msg.walletNewBalance);       // absolute (legacy feeds)
      } else {                                                // running total (Helius)
        const cur = balances.get(msg.wallet) || 0;
        balances.set(msg.wallet, Math.max(0, cur + (msg.side === 'buy' ? msg.tokens : -msg.tokens)));
      }
    }
    lastPool = { base: msg.vTokens, quote: msg.vSol };
    if (msg.vTokens > 0) lastPrice = msg.vSol / msg.vTokens;
  }

  function deriveHolders() {
    if (rpcHolders) return rpcHolders;              // RPC corrector wins when fresh
    const rows = [];
    for (const [wallet, tokens] of balances) {
      const pct = tokens / supply * 100;
      if (pct > 0.0001) rows.push({ wallet, pct });
    }
    rows.sort((a, b) => b.pct - a.pct);
    return rows.slice(0, 12);
  }

  /* Emit the tick for time t and clear the per-tick trade list. Quiet ticks
   * still carry the last pool sample — the engine's liquidity ring needs one. */
  function flush(t) {
    const tick = {
      t,
      price: lastPrice,
      trades: pending,
      pool: lastPool ? { base: lastPool.base, quote: lastPool.quote } : { base: supply, quote: 0 },
      holders: deriveHolders(),
      flags: Object.assign({}, flags),
    };
    pending = [];
    return tick;
  }

  function setFlag(name, value) { if (name in flags) flags[name] = !!value; }
  function setHolders(rows) { rpcHolders = rows && rows.length ? rows : null; }
  function hasPool() { return !!lastPool; }
  function snapshotPool() { return lastPool ? { base: lastPool.base, quote: lastPool.quote } : null; }

  return { note, flush, setFlag, setHolders, hasPool, snapshotPool, balances,
    get selfWallet() { return selfWallet; }, get devWallet() { return devWallet; } };
}

/* ------------------------------ ws source ------------------------------ */

/* Helius websocket client. On (re)connect it sends a single logsSubscribe for
 * the pump.fun program; that one subscription streams every launch and trade.
 * WebSocketImpl is injectable for tests. */
function createWsSource(opts) {
  const url = opts.url;
  const programId = opts.programId || PUMP_PROGRAM_ID;
  const commitment = opts.commitment || 'processed';
  const WS = opts.WebSocketImpl || require('ws');
  const onMessage = opts.onMessage || (() => {});
  const onStatus = opts.onStatus || (() => {});
  const minMs = opts.reconnectMinMs || 500, maxMs = opts.reconnectMaxMs || 8000;

  let ws = null, backoff = minMs, closed = false, lastMsgAt = 0;

  function send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }
  function subscribe() {
    send({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [programId] }, { commitment }] });
  }

  function connect() {
    if (closed) return;
    ws = new WS(url);
    ws.onopen = () => { backoff = minMs; lastMsgAt = Date.now(); onStatus({ connected: true }); subscribe(); };
    ws.onmessage = (ev) => {
      lastMsgAt = Date.now();
      let raw; try { raw = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(raw, Date.now());
    };
    ws.onclose = () => { onStatus({ connected: false }); scheduleReconnect(); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function scheduleReconnect() {
    if (closed) return;
    setTimeout(connect, backoff);
    backoff = Math.min(maxMs, Math.round(backoff * 2 * (0.8 + Math.random() * 0.4)));
  }

  return {
    start() { closed = false; connect(); },
    close() { closed = true; try { ws && ws.close(); } catch (e) {} },
    // logsSubscribe already covers launches AND trades; these are no-ops kept
    // for interface compatibility with the pipeline's subscribe callbacks.
    subscribeNewToken() {},
    subscribeToken() {},
    unsubscribeToken() {},
    connected() { return !!(ws && ws.readyState === 1); },
    lastMsgAgoMs() { return lastMsgAt ? Date.now() - lastMsgAt : Infinity; },
  };
}

/* ---------------------------- replay source ---------------------------- */

/* Reads recorded { recvT, raw } JSONL lines and drives the pipeline on a
 * virtual clock: no timers, no wall time. Identical every run. */
function createReplaySource(lines, opts) {
  const tickMs = (opts && opts.tickMs) || 250;
  const onMessage = (opts && opts.onMessage) || (() => {});
  const onTick = (opts && opts.onTick) || (() => {});

  const msgs = lines
    .map(l => (typeof l === 'string' ? safeParse(l) : l))
    .filter(Boolean)
    .filter(m => m.recvT != null);
  msgs.sort((a, b) => a.recvT - b.recvT);

  function run() {
    if (!msgs.length) return;
    const t0 = msgs[0].recvT;
    let nextTick = t0 + tickMs;
    for (const m of msgs) {
      while (m.recvT >= nextTick) { onTick(nextTick); nextTick += tickMs; }
      onMessage(m.raw, m.recvT);
    }
    onTick(nextTick);
  }

  return { run, count: msgs.length };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/* ------------------------------ recorder ------------------------------- */

function createRecorder(store, name) {
  const file = store.sessionPath(name + '.jsonl');
  return {
    file,
    record(raw, recvT) { store.appendLine(file, { recvT, raw }); },
  };
}

/* ---------------------------- holder poller ---------------------------- */

/* Throttled getTokenLargestAccounts corrector, run only for OPEN positions.
 * rpcCall is injectable ({ method, params } -> Promise<result>) so tests need
 * no network. Returns holders as [{ wallet, pct }] against the mint supply. */
function createHolderPoller(opts) {
  const intervalMs = (opts && opts.intervalMs) || 2000;
  const supply = (opts && opts.supply) || 1e9;
  const rpcCall = opts && opts.rpcCall;
  const last = new Map();

  async function poll(mint) {
    if (!rpcCall) return null;
    const now = Date.now();
    if (last.has(mint) && now - last.get(mint) < intervalMs) return null;
    last.set(mint, now);
    try {
      const res = await rpcCall({ method: 'getTokenLargestAccounts', params: [mint] });
      const arr = (res && res.value) || [];
      return arr.map(a => ({ wallet: str(a.address), pct: num(a.uiAmount) / supply * 100 }))
        .filter(h => isFinite(h.pct) && h.pct > 0.0001)
        .sort((a, b) => b.pct - a.pct).slice(0, 12);
    } catch (e) { return null; }
  }

  function forget(mint) { last.delete(mint); }
  return { poll, forget };
}

module.exports = {
  decodeNotification, createTickBuilder, createWsSource, createReplaySource,
  createRecorder, createHolderPoller,
};
