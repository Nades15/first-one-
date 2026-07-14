/* Fairline — persistence under fairline/data/ (gitignored). No database:
 * append-only JSONL for the trade log, atomic write-temp-rename for JSON
 * docs. Same shape as livebot/js/store.js; the gate-relevant paper stats are
 * cached and invalidated on append. */
'use strict';

const fs = require('fs');
const path = require('path');

function createStore(opts) {
  const dir = (opts && opts.dir) || path.join(__dirname, '..', 'data');
  const sessDir = path.join(dir, 'sessions');
  fs.mkdirSync(sessDir, { recursive: true });

  const F = {
    trades: path.join(dir, 'trades.jsonl'),
    ledger: path.join(dir, 'ledger.json'),
    settings: path.join(dir, 'settings.json'),
  };

  function appendLine(file, obj) {
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  }
  function readLines(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
    return text.split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch (e) { return null; }
    }).filter(Boolean);
  }
  function readJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
  }
  function writeJSON(file, obj) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);            // atomic on POSIX
  }

  /* --------------------------------- trades -------------------------------- */
  let gateCache = null;                  // invalidated on every appendTrade

  function appendTrade(rec) {
    appendLine(F.trades, rec);
    gateCache = null;
  }
  function allTrades() { return readLines(F.trades); }
  function recentTrades(n) {
    const all = allTrades();
    return all.slice(Math.max(0, all.length - (n || 50)));
  }

  /* Paper-only stats for the gate. */
  function gateStats() {
    if (gateCache) return gateCache;
    let paperTrades = 0, paperNetUsd = 0;
    for (const t of allTrades()) {
      if (t.mode !== 'paper') continue;
      paperTrades++;
      paperNetUsd += Number(t.pnlNetUsd) || 0;
    }
    gateCache = { paperTrades, paperNetUsd: round(paperNetUsd, 4) };
    return gateCache;
  }

  /* Calibration buckets for the dashboard: settled trades grouped by the
   * model's entry-time probability for the side we took, against how often
   * that side actually won. A well-calibrated model tracks the diagonal. */
  function calibration(bucketWidth) {
    const w = bucketWidth || 0.1;
    const buckets = new Map();             // bucketLo -> { n, wins, probSum }
    for (const t of allTrades()) {
      const p = Number(t.entryFair);
      if (!isFinite(p) || t.won == null) continue;
      const lo = Math.min(1 - w, Math.floor(p / w) * w);
      const b = buckets.get(lo) || { lo: round(lo, 4), n: 0, wins: 0, probSum: 0 };
      b.n++; b.wins += t.won ? 1 : 0; b.probSum += p;
      buckets.set(lo, b);
    }
    return Array.from(buckets.values()).sort((a, b) => a.lo - b.lo)
      .map(b => ({ lo: b.lo, n: b.n, predicted: round(b.probSum / b.n, 4), actual: round(b.wins / b.n, 4) }));
  }

  /* --------------------------------- ledger -------------------------------- */
  function readLedger() { return readJSON(F.ledger, null); }
  function writeLedger(l) { writeJSON(F.ledger, l); }

  /* -------------------------------- settings ------------------------------- */
  function readSettings() { return readJSON(F.settings, {}); }

  /* -------------------------------- sessions ------------------------------- */
  function sessionPath(name) {
    const safe = String(name).replace(/[^0-9A-Za-z._-]/g, '_');
    return path.join(sessDir, safe);
  }

  return {
    dir, files: F,
    appendTrade, allTrades, recentTrades, gateStats, calibration,
    readLedger, writeLedger,
    readSettings,
    sessionPath, appendLine, readLines,
  };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createStore };
