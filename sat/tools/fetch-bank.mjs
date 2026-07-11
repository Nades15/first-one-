#!/usr/bin/env node
/*
 * Summit — download the official SAT Suite Question Bank into sat/data/bank.json.
 *
 * Pulls every digital-SAT question (Reading & Writing + Math, ~3,000 items)
 * from College Board's public qbank API — the same source the in-app
 * downloader uses, but faster and kinder to flaky connections: re-running
 * the script resumes from what's already in the output file.
 *
 * Usage (node 18+, run from the repo root or sat/):
 *   node sat/tools/fetch-bank.mjs                 # full bank -> sat/data/bank.json
 *   node sat/tools/fetch-bank.mjs --limit 5       # smoke test: 5 items per section
 *   node sat/tools/fetch-bank.mjs --section math  # one section only
 *   node sat/tools/fetch-bank.mjs --out my.json   # custom output path
 *
 * The output is College Board's copyrighted content — keep it local
 * (sat/data/.gitignore already excludes it); don't commit or redistribute it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Qnorm = require('../js/qnorm.js');

const QBANK_API = 'https://qbank-api.collegeboard.org/msreportingquestionbank/questionbank/digital';
const ASMT_EVENT_ID = 99;
const SECTIONS = {
  rw:   { label: 'Reading & Writing', test: 1, domains: 'INI,CAS,EOI,SEC' },
  math: { label: 'Math',              test: 2, domains: 'H,P,Q,S' },
};
const CONCURRENCY = 8;
const RETRIES = 3;

/* ------------------------------ args ------------------------------ */

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] || '') : null;
};
const limit = Number(flag('limit')) || 0;
const sectionArg = flag('section');
const outPath = flag('out') ||
  join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bank.json');

const sections = sectionArg ? { [sectionArg]: SECTIONS[sectionArg] } : SECTIONS;
if (sectionArg && !SECTIONS[sectionArg]) {
  console.error(`Unknown --section "${sectionArg}" — use rw or math.`);
  process.exit(1);
}

/* ------------------------------ http ------------------------------ */

async function postJson(path, body) {
  let lastErr;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const r = await fetch(QBANK_API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < RETRIES) await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/* ------------------------------ main ------------------------------ */

/* Resume: anything already in the output file is kept and skipped. */
let existing = new Map();
try {
  const prev = JSON.parse(readFileSync(outPath, 'utf8'));
  for (const q of prev.questions || []) existing.set(q.id, q);
  if (existing.size) console.log(`Resuming: ${existing.size} questions already in ${outPath}`);
} catch { /* no previous file — fresh run */ }

const metas = [];
let skipped = 0;
for (const [key, sec] of Object.entries(sections)) {
  process.stdout.write(`Fetching ${sec.label} question list... `);
  let rows;
  try {
    rows = await postJson('/get-questions',
      { asmtEventId: ASMT_EVENT_ID, test: sec.test, domain: sec.domains });
  } catch (e) {
    console.error(`\nCould not reach College Board's question bank (${e.message}).`);
    console.error('Run this script from a normal network — the API is public but some');
    console.error('managed/proxied environments block the collegeboard.org domain.');
    process.exit(1);
  }
  let secMetas = rows.map(r => Qnorm.normalizeMeta(r, key));
  const withId = secMetas.filter(m => m.external);
  skipped += secMetas.length - withId.length;   // paper-test items on another endpoint
  secMetas = limit > 0 ? withId.slice(0, limit) : withId;
  metas.push(...secMetas);
  console.log(`${secMetas.length} questions${limit ? ` (limited from ${withId.length})` : ''}`);
}

const todo = metas.filter(m => !existing.has(m.id));
console.log(`Downloading ${todo.length} questions (${metas.length - todo.length} already cached)...`);

let done = 0, failed = 0;
const queue = todo.slice();
async function worker() {
  for (let m = queue.shift(); m; m = queue.shift()) {
    try {
      const raw = await postJson('/get-question', { external_id: m.external });
      existing.set(m.id, Qnorm.normalizeItem(m, raw));
    } catch (e) {
      failed++;
    }
    done++;
    if (done % 25 === 0 || done === todo.length) {
      process.stdout.write(`\r  ${done}/${todo.length} fetched${failed ? `, ${failed} failed` : ''}   `);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (todo.length) process.stdout.write('\n');

const questions = metas.map(m => existing.get(m.id)).filter(Boolean);
const counts = {};
for (const q of questions) counts[q.section] = (counts[q.section] || 0) + 1;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  meta: {
    source: 'College Board SAT Suite Question Bank',
    fetchedAt: new Date().toISOString(),
    counts,
    skippedPaperItems: skipped,
    failed,
  },
  questions,
}, null, 1));

console.log(`Wrote ${questions.length} questions to ${outPath}`
  + ` (rw: ${counts.rw || 0}, math: ${counts.math || 0}`
  + `${skipped ? `, ${skipped} paper-test items skipped` : ''}`
  + `${failed ? `, ${failed} failed — re-run to retry` : ''})`);
console.log('Reminder: this file is College Board content — keep it local, do not commit it.');
