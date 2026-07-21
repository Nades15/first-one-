/* Phase 0 probe — run on the DESKTOP (direct network, no proxy).
 *   node fairline/research/probe-clob-ws.js
 *
 * Grounds the market-making build in reality: connects to Polymarket's live
 * CLOB websocket, prints the actual message schema, and — critically —
 * measures TRADE FREQUENCY and SPREAD per market. Market-making needs
 * counterparty flow (trades) AND spread; this tells us whether either
 * exists on slow crypto markets before we build a collector around them. */
'use strict';
const WS = require('../node_modules/ws');   // ws is already installed in fairline/

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const RUN_MS = 60000;

(async () => {
  // pick a spread of slow crypto markets: liquid+tight AND thinner+wider
  const now = Date.now();
  const r = await fetch(GAMMA + '/markets?active=true&closed=false&limit=500&order=volume24hr&ascending=false');
  const all = await r.json();
  const slow = all.filter(m => {
    const t = (m.question || '') + ' ' + (m.slug || '');
    if (!/bitcoin|btc|ethereum|eth|solana/i.test(t)) return false;
    if (!m.clobTokenIds || !m.endDate) return false;
    const hrs = (Date.parse(m.endDate) - now) / 3600e3;
    return hrs > 1 && hrs < 24 * 40;
  });
  // take a few across the spread range
  slow.sort((a, b) => (a.spread || 0) - (b.spread || 0));
  const pick = [slow[0], slow[Math.floor(slow.length / 2)], slow[slow.length - 1]].filter(Boolean);
  const byToken = {};
  const tokens = [];
  for (const m of pick) {
    let ids; try { ids = JSON.parse(m.clobTokenIds); } catch (e) { continue; }
    byToken[ids[0]] = { q: m.question, spread: m.spread, liq: Math.round(m.liquidityNum || 0), yes: ids[0] };
    tokens.push(ids[0]);
    console.log('watching:', (m.question || '').slice(0, 50), '| spread', m.spread, '| liq $' + Math.round(m.liquidityNum || 0));
  }
  console.log('\nconnecting to CLOB ws...\n');

  const seen = {};                    // event_type -> count
  const trades = {};                  // token -> trade count
  const ws = new WS(CLOB_WS);
  ws.on('open', () => ws.send(JSON.stringify({ assets_ids: tokens, type: 'market' })));
  ws.on('message', data => {
    let msgs; try { msgs = JSON.parse(data.toString()); } catch (e) { return; }
    for (const m of (Array.isArray(msgs) ? msgs : [msgs])) {
      const et = m.event_type || m.type || 'unknown';
      seen[et] = (seen[et] || 0) + 1;
      if (seen[et] <= 1) console.log('=== schema: ' + et + ' ===\n' + JSON.stringify(m).slice(0, 600) + '\n');
      if (/trade/i.test(et)) { const tk = m.asset_id || m.market; trades[tk] = (trades[tk] || 0) + 1; }
    }
  });
  ws.on('error', e => console.log('WS ERROR:', e.message));
  ws.on('close', c => console.log('closed', c));

  setTimeout(() => {
    console.log('\n===== ' + (RUN_MS / 1000) + 's SUMMARY =====');
    console.log('event-type counts:', JSON.stringify(seen));
    console.log('trades observed per market:');
    for (const tk of tokens) {
      const info = byToken[tk] || {};
      console.log('  ' + (trades[tk] || 0) + ' trades | spread ' + info.spread + ' | ' + (info.q || '').slice(0, 45));
    }
    console.log('\nMM read: need BOTH trades (flow) AND spread. Zero-trade or');
    console.log('zero-spread markets cannot be profitably made.');
    process.exit(0);
  }, RUN_MS);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
