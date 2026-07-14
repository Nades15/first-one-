/* Fairline — session recording and deterministic replay (Livebot feed.js
 * pattern, adapted to fairline's three event kinds).
 *
 * Every live input is recorded as one JSONL line under data/sessions/:
 *   { recvT, kind:'spot',    asset, price }        (throttled per asset)
 *   { recvT, kind:'markets', list }                (each discovery sweep)
 *   { recvT, kind:'book',    key, book }           (each book refresh)
 *
 * recvT is absolute epoch ms — market closeTimes are absolute, so replay
 * walks the original timeline. run() feeds events back through the same
 * pipeline inputs and flushes ticks at every tickMs boundary: no timers, no
 * wall time, identical every run. */
'use strict';

const SPOT_RECORD_THROTTLE_MS = 250;   // ≥4 spot lines/s/asset is plenty for a 1s sampler

/* ------------------------------- recorder ------------------------------- */

function createRecorder(store, name) {
  const file = store.sessionPath(name + '.jsonl');
  const lastSpotAt = new Map();          // asset -> last recorded recvT

  return {
    file,
    spot(asset, price, recvT) {
      const last = lastSpotAt.get(asset) || 0;
      if (recvT - last < SPOT_RECORD_THROTTLE_MS) return;
      lastSpotAt.set(asset, recvT);
      store.appendLine(file, { recvT, kind: 'spot', asset, price });
    },
    markets(list, recvT) {
      store.appendLine(file, { recvT, kind: 'markets', list });
    },
    book(key, book, recvT) {
      store.appendLine(file, { recvT, kind: 'book', key, book });
    },
  };
}

/* -------------------------------- replay -------------------------------- */

function createReplaySource(lines, opts) {
  const tickMs = (opts && opts.tickMs) || 1000;
  const pipe = opts.pipe;

  const events = lines
    .map(l => (typeof l === 'string' ? safeParse(l) : l))
    .filter(e => e && e.recvT != null && e.kind)
    .sort((a, b) => a.recvT - b.recvT);

  function feed(e) {
    if (e.kind === 'spot') pipe.onSpot(e.asset, e.price, e.recvT);
    else if (e.kind === 'markets') pipe.onMarkets(e.list, e.recvT);
    else if (e.kind === 'book') pipe.onBook(e.key, e.book);
  }

  function run() {
    if (!events.length) return;
    // Ticks fire on the same absolute clock as recvT (t0+tickMs, t0+2·tickMs…)
    // so book staleness and market closeTimes line up exactly as they did live.
    let nextTick = events[0].recvT + tickMs;
    for (const e of events) {
      while (e.recvT >= nextTick) { pipe.onTick(nextTick); nextTick += tickMs; }
      feed(e);
    }
    pipe.onTick(nextTick);                       // final flush so last events land
  }

  return { run, count: events.length };
}

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

module.exports = { createRecorder, createReplaySource, SPOT_RECORD_THROTTLE_MS };
