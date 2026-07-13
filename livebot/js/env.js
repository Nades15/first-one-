/* Minimal .env loader — no dotenv dependency. Parses KEY=VALUE lines from
 * livebot/.env into a plain object; blank lines and #-comments ignored;
 * surrounding quotes stripped. Does NOT mutate process.env, so a stray log
 * of the environment can't leak the key. */
'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDERS = [
  'YOUR_KEY_HERE', 'PUT_YOUR_BURNER_BASE58_SECRET_KEY_HERE', '',
];

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/* Load livebot/.env if present. Returns { HELIUS_RPC_URL, WALLET_SECRET_KEY,
 * LIVEBOT_PORT, ... }. Missing file → empty object (paper mode can still run
 * with defaults; live mode validates below). */
function load(dir) {
  const file = path.join(dir || path.join(__dirname, '..'), '.env');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { __file: file, __exists: false }; }
  const env = parse(text);
  env.__file = file;
  env.__exists = true;
  return env;
}

function isPlaceholder(v) {
  return v == null || PLACEHOLDERS.includes(String(v).trim()) ||
    String(v).includes('YOUR_KEY_HERE') || String(v).includes('PUT_YOUR_BURNER');
}

/* Throw a clear error if the values needed for LIVE trading are missing or
 * still placeholders. Paper mode calls this with { requireWallet:false }. */
function validate(env, opts) {
  const requireWallet = !opts || opts.requireWallet !== false;
  const problems = [];
  if (isPlaceholder(env.HELIUS_RPC_URL)) problems.push('HELIUS_RPC_URL is missing or still a placeholder');
  if (requireWallet && isPlaceholder(env.WALLET_SECRET_KEY)) {
    problems.push('WALLET_SECRET_KEY is missing or still a placeholder');
  }
  if (problems.length) {
    throw new Error('livebot/.env not configured:\n  - ' + problems.join('\n  - ') +
      '\nCopy livebot/.env.example to livebot/.env and fill it in.');
  }
  return env;
}

module.exports = { load, parse, validate, isPlaceholder };
