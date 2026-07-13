/* Livebot — persistence under livebot/data/ (gitignored). No database:
 * append-only JSONL for logs, atomic write-temp-rename for JSON docs.
 * The gate-relevant paper-trade stats are cached and invalidated on append. */
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
    blacklist: path.join(dir, 'blacklist.json'),
    settings: path.join(dir, 'settings.json'),
    skips: path.join(dir, 'skips.jsonl'),
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

  /* Paper-only stats for the go-live gate. */
  function gateStats() {
    if (gateCache) return gateCache;
    let paperTrades = 0, paperNetSol = 0;
    for (const t of allTrades()) {
      if (t.mode !== 'paper') continue;
      paperTrades++;
      paperNetSol += Number(t.pnlNetSol) || 0;
    }
    gateCache = { paperTrades, paperNetSol: round(paperNetSol, 6) };
    return gateCache;
  }

  /* --------------------------------- ledger -------------------------------- */
  function readLedger() { return readJSON(F.ledger, null); }
  function writeLedger(l) { writeJSON(F.ledger, l); }

  /* ------------------------------- blacklist ------------------------------- */
  function readBlacklist() { return readJSON(F.blacklist, {}); }
  function addBlacklist(creator, why, mint) {
    const bl = readBlacklist();
    if (!bl[creator]) { bl[creator] = { addedWallTime: Date.now(), why, mint }; writeJSON(F.blacklist, bl); }
    return bl;
  }

  /* -------------------------------- settings ------------------------------- */
  function readSettings() { return readJSON(F.settings, {}); }

  /* --------------------------------- skips --------------------------------- */
  function appendSkip(rec) { appendLine(F.skips, rec); }

  /* -------------------------------- sessions ------------------------------- */
  function sessionPath(name) {
    const safe = String(name).replace(/[^0-9A-Za-z._-]/g, '_');
    return path.join(sessDir, safe);
  }

  return {
    dir, files: F,
    appendTrade, allTrades, recentTrades, gateStats,
    readLedger, writeLedger,
    readBlacklist, addBlacklist,
    readSettings,
    appendSkip,
    sessionPath, appendLine, readLines,
  };
}

function round(x, dp) { const m = Math.pow(10, dp); return Math.round(x * m) / m; }

module.exports = { createStore };
