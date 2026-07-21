/* Phase 0 probe #2 — DEFINITIVE trade-frequency check (desktop, direct net).
 *   node fairline/research/probe-flow.js
 *
 * Resolves the "0 trades" question independently of the ws: pulls Polymarket's
 * public trade history (data-api) for a RANGE of crypto markets — hourly
 * up/down through monthly strikes — and reports real trades/hour next to
 * spread. Market-making needs both. If even the most active horizon is thin,
 * the venue is closed; if some horizon has real flow + spread, that's the
 * thread to pull. Prints the raw trade schema so we ground the collector. */
'use strict';
const GAMMA = 'https://gamma-api.polymarket.com';
const DATA = 'https://data-api.polymarket.com';

async function tradesLastHour(conditionId) {
  // data-api /trades: recent executions for a market (condition id)
  const r = await fetch(DATA + '/trades?market=' + conditionId + '&limit=500&takerOnly=false');
  if (!r.ok) return { err: 'HTTP ' + r.status };
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) return { n: 0, perHour: 0, sample: null };
  const now = Date.now() / 1000;
  const ts = arr.map(t => Number(t.timestamp)).filter(x => x > 0).sort((a, b) => b - a);
  const lastHour = ts.filter(x => x > now - 3600).length;
  const spanSec = ts.length > 1 ? (ts[0] - ts[ts.length - 1]) : 0;
  const perHour = spanSec > 0 ? Math.round(arr.length / (spanSec / 3600)) : lastHour;
  return { n: arr.length, lastHour, perHour, spanMin: Math.round(spanSec / 60), sample: arr[0] };
}

(async () => {
  const now = Date.now();
  const r = await fetch(GAMMA + '/markets?active=true&closed=false&limit=500&order=volume24hr&ascending=false');
  const all = await r.json();
  const crypto = all.filter(m => {
    const t = (m.question || '') + ' ' + (m.slug || '');
    return /bitcoin|btc|ethereum|eth|solana/i.test(t) && m.conditionId && m.endDate;
  }).map(m => ({ ...m, hrs: (Date.parse(m.endDate) - now) / 3600e3 }))
    .filter(m => m.hrs > 0.05 && m.hrs < 24 * 40);

  // bucket by horizon and take the most liquid in each
  const buckets = { '<1h': [], '1-6h': [], '6-48h': [], '>48h': [] };
  for (const m of crypto) {
    const b = m.hrs < 1 ? '<1h' : m.hrs < 6 ? '1-6h' : m.hrs < 48 ? '6-48h' : '>48h';
    buckets[b].push(m);
  }
  console.log('horizon   trades/hr  lastHr  spread   liq       market');
  let schemaShown = false;
  for (const b of Object.keys(buckets)) {
    const list = buckets[b].sort((x, y) => (y.liquidityNum || 0) - (x.liquidityNum || 0)).slice(0, 2);
    for (const m of list) {
      const f = await tradesLastHour(m.conditionId);
      console.log('  ' + b.padEnd(8),
        String(f.perHour != null ? f.perHour : f.err).padStart(8),
        String(f.lastHour != null ? f.lastHour : '-').padStart(7),
        String(m.spread).padStart(8),
        ('$' + Math.round(m.liquidityNum || 0)).padStart(9), ' ' + (m.question || '').slice(0, 40));
      if (!schemaShown && f.sample) { console.log('    raw trade:', JSON.stringify(f.sample).slice(0, 300)); schemaShown = true; }
      await new Promise(r => setTimeout(r, 150));
    }
  }
  console.log('\nMM viability: a market needs meaningful trades/hr AND a spread wider');
  console.log('than ~1c to be worth making. Read the table for any row with both.');
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
