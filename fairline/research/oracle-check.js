/* Score Fairline's settled paper trades against Polymarket's ACTUAL
 * resolutions (Gamma outcomePrices after close) instead of our own
 * spot-feed judgment. Read-only.
 *
 *   node fairline/research/oracle-check.js
 *
 * Why this exists: counterfactual replays showed our feed-based settlement
 * flips ~1/3 of 5-minute up/down outcomes depending on sampling granularity
 * — borderline windows are razor-thin, so only the oracle's answer counts.
 * This script is the trustworthy scoreboard. */
'use strict';
const path = require('path').join(__dirname, '..') + '/';
const { proxySupport } = require(path + 'js/proxy.js');
const px = proxySupport();
const doFetch = px.fetchImpl || fetch;
const fs = require('fs');

const all = fs.readFileSync(path + 'data/trades.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const settled = all.filter(t => t.won !== null && t.platform === 'polymarket');
const ids = [...new Set(settled.map(t => t.key.split(':')[1]))];

(async () => {
  const truth = {};
  for (const id of ids) {
    try {
      const r = await doFetch('https://gamma-api.polymarket.com/markets/' + id);
      const m = await r.json();
      let prices; try { prices = JSON.parse(m.outcomePrices); } catch (e) { prices = null; }
      if (prices && (prices[0] === '1' || prices[0] === '0')) truth[id] = prices[0] === '1';
    } catch (e) {}
    await new Promise(res => setTimeout(res, 120));
  }
  let agree = 0, flip = 0, unknown = 0, ourPnl = 0, oraclePnl = 0;
  let oracleW = 0, oracleL = 0, hiW = 0, hiL = 0, hiOraclePnl = 0, loOraclePnl = 0;
  for (const t of settled) {
    const tr = truth[t.key.split(':')[1]];
    if (tr === undefined) { unknown++; continue; }
    const oracleWon = t.side === 'yes' ? tr : !tr;
    ourPnl += t.pnlNetUsd;
    const oPnl = (oracleWon ? t.contracts : 0) - t.costUsd - t.feeUsd;
    oraclePnl += oPnl;
    if (oracleWon === t.won) agree++; else flip++;
    if (oracleWon) oracleW++; else oracleL++;
    if (t.entryFair >= 0.60) { oracleWon ? hiW++ : hiL++; hiOraclePnl += oPnl; }
    else loOraclePnl += oPnl;
  }
  console.log('settled polymarket trades:', settled.length, '| oracle resolutions found:', settled.length - unknown, '| unknown:', unknown);
  console.log('our judgment vs oracle: agree', agree, '| flipped', flip);
  console.log('oracle-true record:', oracleW + '-' + oracleL, '| hi-conf (>=60%):', hiW + '-' + hiL);
  console.log('settled pnl — our judge: $' + ourPnl.toFixed(2), '| oracle judge: $' + oraclePnl.toFixed(2));
  console.log('oracle pnl split — hi-conf: $' + hiOraclePnl.toFixed(2), '| lo-conf: $' + loOraclePnl.toFixed(2));
})();
