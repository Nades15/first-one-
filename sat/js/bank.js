/* Summit — the question bank. Load order:
 *   1. ?mock=1            → data/sample-bank.json (bundled, clearly labeled)
 *   2. data/bank.json     → written by tools/fetch-bank.mjs (not committed)
 *   3. IndexedDB          → filled by the in-app downloader below
 * If none exist the app shows the setup screen and offers the download.
 *
 * The in-app downloader talks straight to College Board's public qbank API
 * from the student's browser (~3k questions ≈ a few minutes; resumable —
 * already-stored items are skipped on re-run). If the API refuses browser
 * origins, each call retries once through the CORS proxy from Settings. */
window.SMBank = (function () {
  'use strict';

  const DB_NAME = 'summit-bank-v1';
  let bank = null;                     // { meta, questions, byId }
  let useProxy = false;                // sticky once direct calls fail

  function isMock() { return /[?&]mock=1/.test(location.search); }

  /* --------------------------- IndexedDB ---------------------------- */

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbReq(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const idbGetAll = (db, store) => idbReq(db.transaction(store).objectStore(store).getAll());
  const idbGetAllKeys = (db, store) => idbReq(db.transaction(store).objectStore(store).getAllKeys());
  const idbGet = (db, store, key) => idbReq(db.transaction(store).objectStore(store).get(key));
  const idbPut = (db, store, val, key) =>
    idbReq(db.transaction(store, 'readwrite').objectStore(store).put(val, key));
  const idbClear = (db, store) =>
    idbReq(db.transaction(store, 'readwrite').objectStore(store).clear());

  /* ----------------------------- loading ---------------------------- */

  async function fetchLocalJson(url) {
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function idbLoad() {
    try {
      const db = await openDb();
      const items = await idbGetAll(db, 'items');
      const meta = await idbGet(db, 'meta', 'meta');
      db.close();
      if (!items.length) return null;
      return { meta: meta || { source: 'downloaded' }, questions: items };
    } catch (e) { return null; }
  }

  async function load(force) {
    if (bank && !force) return bank;
    let b = null;
    if (isMock()) {
      b = await fetchLocalJson('data/sample-bank.json');
    } else {
      b = await fetchLocalJson('data/bank.json');
      if (!b) b = await idbLoad();
    }
    if (!b || !Array.isArray(b.questions) || !b.questions.length) return null;
    b.meta = b.meta || {};
    b.byId = {};
    for (const q of b.questions) b.byId[q.id] = q;
    bank = b;
    return bank;
  }

  function current() { return bank; }

  /* --------------------------- downloading -------------------------- */

  async function postJson(url, body, proxy) {
    const attempt = async viaProxy => {
      const r = await fetch(viaProxy ? proxy + encodeURIComponent(url) : url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    };
    if (!useProxy) {
      try { return await attempt(false); }
      catch (e) { if (!proxy) throw e; useProxy = true; }
    }
    return attempt(true);
  }

  async function download(onProgress, opts) {
    const proxy = (opts && opts.corsProxy) || SMConfig.DEFAULT_CORS_PROXY;

    /* Both section lists first — cheap, and fails fast when offline. */
    const metas = [];
    let skipped = 0;
    for (const key of Object.keys(SMConfig.SECTIONS)) {
      const sec = SMConfig.SECTIONS[key];
      const rows = await postJson(SMConfig.QBANK_API + '/get-questions',
        { asmtEventId: SMConfig.ASMT_EVENT_ID, test: sec.test, domain: sec.domains }, proxy);
      if (!Array.isArray(rows)) throw new Error(sec.label + ' question list did not load');
      for (const row of rows) {
        const m = SMQnorm.normalizeMeta(row, key);
        if (m.external) metas.push(m);
        else skipped++;                // paper-test disclosures on another endpoint
      }
    }
    if (!metas.length) throw new Error('College Board returned an empty question list');

    const db = await openDb();
    const have = new Set(await idbGetAllKeys(db, 'items'));
    const queue = metas.filter(m => !have.has(m.id));
    const total = metas.length;
    let done = total - queue.length, failed = 0;
    if (onProgress) onProgress(done, total);

    async function worker() {
      for (let m = queue.shift(); m; m = queue.shift()) {
        try {
          const raw = await postJson(SMConfig.QBANK_API + '/get-question',
            { external_id: m.external }, proxy);
          await idbPut(db, 'items', SMQnorm.normalizeItem(m, raw));
        } catch (e) { failed++; }
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);

    await idbPut(db, 'meta', {
      source: 'College Board SAT Suite Question Bank',
      fetchedAt: new Date().toISOString(),
      skippedPaperItems: skipped,
      failed,
    }, 'meta');
    db.close();

    const b = await load(true);
    if (!b) throw new Error('Download finished but nothing was stored — try again');
    return { bank: b, failed, skipped };
  }

  async function clearDownloaded() {
    const db = await openDb();
    await idbClear(db, 'items');
    await idbClear(db, 'meta');
    db.close();
    bank = null;
  }

  return { isMock, load, current, download, clearDownloaded };
})();
