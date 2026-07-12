/* Livebot — market feed adapter. Turns the PumpPortal websocket into the
 * exact tick shape scalper/js/exit.js consumes. Pure, testable units
 * (normalizeMsg, TickBuilder) are separated from the IO units (ws source,
 * holder poller). A replay source feeds recorded sessions back on a virtual
 * clock so the whole pipeline is deterministic in tests.
 *
 * PumpPortal message fields (verified July 2026):
 *   create: { txType:'create', signature, mint, traderPublicKey, name, symbol,
 *             uri, initialBuy(tokens), solAmount(SOL dev spent),
 *             vTokensInBondingCurve, vSolInBondingCurve, marketCapSol }
 *   trade:  { txType:'buy'|'sell', signature, mint, traderPublicKey,
 *             tokenAmount, solAmount, newTokenBalance,
 *             vTokensInBondingCurve, vSolInBondingCurve, marketCapSol }
 * The normalizer is STRICT: anything missing a required field becomes
 * kind:'unknown' and is counted, so schema drift is visible on the dashboard
 * and diagnosable from the always-on raw recording. */
'use strict';

const num = v => { const n = Number(v); return isFinite(n) ? n : NaN; };
const str = v => (v == null ? '' : String(v));

/* ----------------------------- normalizer ------------------------------ */

function normalizeMsg(raw, recvT) {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown', raw, recvT };
  const tx = raw.txType || raw.type;

  if (tx === 'create') {
    const vSol = num(raw.vSolInBondingCurve), vTokens = num(raw.vTokensInBondingCurve);
    if (!raw.mint || !isFinite(vSol) || !isFinite(vTokens) || vTokens <= 0) return unknown(raw, recvT);
    return {
      kind: 'launch', recvT,
      mint: str(raw.mint), creator: str(raw.traderPublicKey),
      name: str(raw.name), symbol: str(raw.symbol), uri: str(raw.uri),
      devBuySol: isFinite(num(raw.solAmount)) ? num(raw.solAmount) : 0,
      devBuyTokens: isFinite(num(raw.initialBuy)) ? num(raw.initialBuy) : 0,
      vSol, vTokens, sig: str(raw.signature),
    };
  }

  if (tx === 'buy' || tx === 'sell') {
    const vSol = num(raw.vSolInBondingCurve), vTokens = num(raw.vTokensInBondingCurve);
    const sol = num(raw.solAmount), tokens = num(raw.tokenAmount);
    if (!raw.mint || !isFinite(vSol) || !isFinite(vTokens) || vTokens <= 0 ||
        !isFinite(sol) || !isFinite(tokens)) return unknown(raw, recvT);
    return {
      kind: 'trade', recvT,
      mint: str(raw.mint), side: tx, wallet: str(raw.traderPublicKey),
      sol, tokens,
      walletNewBalance: isFinite(num(raw.newTokenBalance)) ? num(raw.newTokenBalance) : null,
      vSol, vTokens, sig: str(raw.signature),
    };
  }

  if (tx === 'migrate' || raw.pool === 'pump-amm' && raw.migration) {
    return { kind: 'migration', recvT, mint: str(raw.mint) };
  }

  return unknown(raw, recvT);
}

function unknown(raw, recvT) { return { kind: 'unknown', raw, recvT }; }

/* ----------------------------- TickBuilder ----------------------------- */

/* One per watched mint. Fold normalized messages in with note(); emit an
 * engine tick with flush(t). Holders are derived from the trade stream for
 * free (each trade carries the trader's new absolute balance). */
function createTickBuilder(opts) {
  const supply = (opts && opts.supply) || 1e9;
  const selfWallet = opts && opts.selfWallet;
  const devWallet = opts && opts.devWallet;
  const holderPollOverride = null;                 // set via setHolders()

  const balances = new Map();                       // wallet -> tokens
  let pending = [];                                 // trades since last flush
  let lastPool = null;                              // { base, quote }
  let lastPrice = 0;
  let rpcHolders = null;                            // corrector from RPC, or null
  const flags = { sellRestricted: false, mintEnabled: false, lpUnlocked: false, blacklistRisk: false };

  function seedLaunch(msg) {
    if (msg.creator && msg.devBuyTokens > 0) balances.set(msg.creator, msg.devBuyTokens);
    lastPool = { base: msg.vTokens, quote: msg.vSol };
    lastPrice = msg.vSol / msg.vTokens;
  }

  function note(msg) {
    if (msg.kind === 'launch') { seedLaunch(msg); return; }
    if (msg.kind !== 'trade') return;
    pending.push({ side: msg.side, base: msg.tokens, quote: msg.sol, wallet: msg.wallet });
    if (msg.wallet && msg.walletNewBalance !== null) balances.set(msg.wallet, msg.walletNewBalance);
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
   * (no trades) still carry the last pool sample — the engine's liquidity
   * ring needs one per tick. */
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

/* Thin PumpPortal client with reconnect/backoff and subscription replay.
 * WebSocketImpl is injectable so tests use a fake. Tracks the desired
 * subscription set as the source of truth and re-sends it on every (re)open. */
function createWsSource(opts) {
  const url = opts.url;
  const WS = opts.WebSocketImpl || require('ws');
  const onMessage = opts.onMessage || (() => {});
  const onStatus = opts.onStatus || (() => {});
  const minMs = opts.reconnectMinMs || 500, maxMs = opts.reconnectMaxMs || 8000;

  let ws = null, backoff = minMs, closed = false, lastMsgAt = 0;
  let subNewToken = false;
  const tokenKeys = new Set();

  function send(obj) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }

  function resubscribe() {
    if (subNewToken) send({ method: 'subscribeNewToken' });
    if (tokenKeys.size) send({ method: 'subscribeTokenTrade', keys: Array.from(tokenKeys) });
  }

  function connect() {
    if (closed) return;
    ws = new WS(url);
    ws.onopen = () => { backoff = minMs; lastMsgAt = Date.now(); onStatus({ connected: true }); resubscribe(); };
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
    subscribeNewToken() { subNewToken = true; send({ method: 'subscribeNewToken' }); },
    subscribeToken(mint) { if (!tokenKeys.has(mint)) { tokenKeys.add(mint); send({ method: 'subscribeTokenTrade', keys: [mint] }); } },
    unsubscribeToken(mint) { if (tokenKeys.delete(mint)) send({ method: 'unsubscribeTokenTrade', keys: [mint] }); },
    connected() { return !!(ws && ws.readyState === 1); },
    lastMsgAgoMs() { return lastMsgAt ? Date.now() - lastMsgAt : Infinity; },
  };
}

/* ---------------------------- replay source ---------------------------- */

/* Reads recorded { recvT, raw } JSONL lines and drives the pipeline on a
 * virtual clock: no timers, no wall time. run() walks messages in order,
 * flushing ticks at every tickMs boundary — identical every run. */
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
    // Ticks fire on the SAME absolute clock as recvT (t0+250, t0+500, ...), so
    // the sniper's launchT (an absolute recvT) and the tick time agree.
    let nextTick = t0 + tickMs;
    for (const m of msgs) {
      while (m.recvT >= nextTick) { onTick(nextTick); nextTick += tickMs; }
      onMessage(m.raw, m.recvT);
    }
    onTick(nextTick);                                // final flush so last trades land
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
  const rpcCall = opts && opts.rpcCall;             // async ({method,params}) => result
  const last = new Map();                           // mint -> last poll ms

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
  normalizeMsg, createTickBuilder, createWsSource, createReplaySource,
  createRecorder, createHolderPoller,
};
