/* Scout — screens & wiring. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');
  let tab = 'scan';
  let scanning = false;
  let aiBusy = false;
  let refreshing = false;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pct = p => Math.round(p * 100) + '%';

  function fmtVol(c) {
    const n = c.volume24h;
    const s = n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
    return (c.platform === 'polymarket' ? '$' : '') + s;
  }

  function timeUntil(ms) {
    if (ms === null) return 'no close date';
    const h = (ms - Date.now()) / 3600e3;
    if (h <= 0) return 'closing';
    if (h < 1) return 'closes in ' + Math.max(1, Math.round(h * 60)) + 'm';
    if (h < 48) return 'closes in ' + Math.round(h) + 'h';
    if (h < 24 * 30) return 'closes in ' + Math.round(h / 24) + 'd';
    return 'closes ' + new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ============================= shell ============================= */

  function render() {
    const s = SCStore.load();
    if (!s.settings.onboarded) { renderOnboarding(); return; }
    app().innerHTML =
      '<header class="topbar">' +
        '<div class="brand">🎯 Scout</div>' +
        '<div class="topbar-stats">' +
          (SCPlatforms.isMock() ? '<span class="chip chip-warn">mock data</span>' : '') +
          '<span class="chip">⭐ ' + s.watchlist.length + '</span>' +
          (s.lastScan ? '<span class="chip">' + s.lastScan.candidates.length + ' hits</span>' : '') +
        '</div>' +
      '</header>' +
      '<main class="screen" id="screen"></main>' +
      '<nav class="tabbar">' + ['scan', 'watchlist', 'settings'].map(t =>
        '<button class="tabbtn' + (tab === t ? ' active' : '') + '" data-tab="' + t + '">' +
        { scan: '🔍<span>Scan</span>', watchlist: '⭐<span>Watchlist</span>', settings: '⚙️<span>Settings</span>' }[t] +
        '</button>').join('') +
      '</nav>';
    app().querySelectorAll('.tabbtn').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    ({ scan: renderScan, watchlist: renderWatchlist, settings: renderSettings })[tab]();
  }

  /* ========================== onboarding =========================== */

  function renderOnboarding() {
    app().innerHTML =
      '<main class="screen welcome">' +
        '<div class="logo-big">🎯</div>' +
        '<h1>Scout</h1>' +
        '<p class="tagline">Scan Polymarket and Kalshi on demand for bets the market prices around 75% to hit — filtered by volume and resolution date — then get an optional AI second opinion on whether each price looks fair.</p>' +
        '<div class="card notice">' +
          '<strong>Read this once:</strong> a market price IS the crowd\'s probability — a 75¢ contract that truly hits 75% of the time pays for itself and no more, before fees. The edge, when there is one, comes from spotting prices the crowd got wrong, sizing sanely, and only betting liquid markets. Scout surfaces candidates; it does not print money, and the AI\'s estimate is an opinion with a knowledge cutoff, not ground truth. Not financial advice.' +
        '</div>' +
        '<div class="card form-card">' +
          '<label>Claude API key <span class="hint">(optional — only needed for AI second opinions; from console.anthropic.com, stays on this device)</span>' +
            '<input id="ob-key" type="password" placeholder="sk-ant-... (or leave empty)" autocomplete="off"></label>' +
          '<button class="btn btn-primary btn-lg" id="ob-go">Start scanning</button>' +
          '<p class="fineprint">Price scans use Polymarket & Kalshi\'s free public APIs — no account or key needed. Everything is stored only in this browser.</p>' +
        '</div>' +
      '</main>';
    $('#ob-go').onclick = () => {
      const s = SCStore.load();
      s.settings.apiKey = $('#ob-key').value.trim();
      s.settings.onboarded = true;
      SCStore.save();
      render();
    };
  }

  /* ============================= scan ============================== */

  function renderScan() {
    const s = SCStore.load();
    const f = s.settings.filters;
    $('#screen').innerHTML =
      '<div class="card form-card">' +
        '<div class="card-head"><h2>Scan for the 75% zone</h2><span class="card-sub">markets priced inside your band</span></div>' +
        '<div class="row-gap">' +
          '<label class="check"><input type="checkbox" id="f-poly"' + (f.platforms.polymarket ? ' checked' : '') + '> Polymarket</label>' +
          '<label class="check"><input type="checkbox" id="f-kalshi"' + (f.platforms.kalshi ? ' checked' : '') + '> Kalshi</label>' +
        '</div>' +
        '<div class="form-grid">' +
          '<label>Band low (%)<input id="f-lo" type="number" min="50" max="98" value="' + f.bandLo + '"></label>' +
          '<label>Band high (%)<input id="f-hi" type="number" min="51" max="99" value="' + f.bandHi + '"></label>' +
          '<label>Min 24h volume<input id="f-vol" type="number" min="0" step="100" value="' + f.minVolume24h + '"><span class="hint">$ on Polymarket, contracts on Kalshi</span></label>' +
          '<label>Resolution<select id="f-win">' + SCConfig.WINDOWS.map(w =>
            '<option value="' + w.hours + '"' + (w.hours === f.resolveWithinHours ? ' selected' : '') + '>' + w.label + '</option>').join('') + '</select></label>' +
          '<label>Scan depth<select id="f-depth">' + Object.keys(SCConfig.DEPTHS).map(d =>
            '<option value="' + d + '"' + (d === f.depth ? ' selected' : '') + '>' + SCConfig.DEPTHS[d].label + '</option>').join('') + '</select></label>' +
          '<label>Keyword <span class="hint">(optional)</span><input id="f-kw" type="text" placeholder="fed, nba, bitcoin…" value="' + esc(f.keyword) + '"></label>' +
        '</div>' +
        '<button class="btn btn-primary btn-lg" id="scan-go"' + (scanning ? ' disabled' : '') + '>' +
          (scanning ? 'Scanning…' : '🔍 Scan now') + '</button>' +
        '<div id="scan-status" class="muted"></div>' +
        '<div id="scan-error" class="error-text"></div>' +
      '</div>' +
      '<div id="scan-results">' + resultsHTML(s) + '</div>';

    $('#scan-go').onclick = runScan;
    wireResults();
  }

  function resultsHTML(s) {
    const scan = s.lastScan;
    if (!scan) {
      return '<div class="card"><p class="muted">No scan yet. Set your band and hit <strong>Scan now</strong> — a 70–80% band finds markets the crowd prices around 3-in-4 to hit.</p></div>';
    }
    const when = new Date(scan.when).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    let html = '<div class="card-head-lone"><h2>' + scan.candidates.length + ' candidates</h2>' +
      '<span class="card-sub">' + scan.scanned.toLocaleString() + ' markets scanned · ' + when + '</span></div>';
    if (!scan.candidates.length) {
      return html + '<div class="card"><p class="muted">Nothing landed in the ' + scan.params.bandLo + '–' + scan.params.bandHi + '% band with those filters. Widen the band, lower the volume floor, or extend the resolution window.</p></div>';
    }
    const s2 = SCStore.load();
    const topN = Math.min(s2.settings.aiTopN, scan.candidates.length);
    html += '<div class="card ai-bar"><div class="row-gap">' +
      '<button class="btn" id="ai-go"' + (aiBusy ? ' disabled' : '') + '>' +
        (aiBusy ? '🤖 Thinking…' : '🤖 AI second opinion (top ' + topN + ')') + '</button>' +
      '<span class="card-sub">Claude estimates each probability independently and flags prices it disagrees with. Costs a few cents.</span>' +
      '</div><div id="ai-error" class="error-text"></div></div>';
    html += scan.candidates.map(candidateCardHTML).join('');
    html += '<p class="fineprint">Prices move — always confirm on the platform before betting. Market data © Polymarket / Kalshi public APIs. Not financial advice.</p>';
    return html;
  }

  function candidateCardHTML(c) {
    const starred = SCStore.load().watchlist.some(w => w.key === c.key);
    const probPct = Math.round(c.prob * 100);
    let aiHtml = '';
    if (c.ai) {
      const v = c.ai.verdict;
      const cls = v === 'MARKET_TOO_LOW' ? 'ai-value' : v === 'MARKET_TOO_HIGH' ? 'ai-over' : 'ai-agree';
      const label = v === 'MARKET_TOO_LOW' ? '💎 possible value — AI sees higher odds'
        : v === 'MARKET_TOO_HIGH' ? '⚠️ AI sees lower odds than the price'
        : '✓ AI roughly agrees with the market';
      aiHtml = '<div class="ai-row ' + cls + '">' +
        '<div class="ai-verdict">AI: <strong>' + c.ai.aiProb + '%</strong> vs market ' + probPct + '% · ' + label + '</div>' +
        '<div class="ai-reason">' + esc(c.ai.reasoning) + (c.ai.caution ? ' <span class="muted">⚠ ' + esc(c.ai.caution) + '</span>' : '') + '</div>' +
        '</div>';
    }
    return '<div class="card cand">' +
      '<div class="cand-head">' +
        '<span class="chip plat-' + c.platform + '">' + (c.platform === 'polymarket' ? 'Polymarket' : 'Kalshi') + '</span>' +
        '<button class="btn btn-ghost btn-sm star' + (starred ? ' starred' : '') + '" data-star="' + esc(c.key) + '">' + (starred ? '⭐' : '☆') + '</button>' +
      '</div>' +
      '<a class="cand-title" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(c.title) + ' ↗</a>' +
      '<div class="cand-prob-row">' +
        '<span class="side-chip">' + esc(c.side) + '</span>' +
        '<span class="cand-prob">' + probPct + '%</span>' +
        '<div class="meter cand-meter"><div class="meter-fill target" style="width:' + probPct + '%"></div></div>' +
      '</div>' +
      '<div class="cand-sub muted">' + fmtVol(c) + ' · 24h vol · ' + timeUntil(c.closeTime) +
        (c.category ? ' · ' + esc(c.category) : '') + '</div>' +
      aiHtml +
      '</div>';
  }

  function wireResults() {
    document.querySelectorAll('[data-star]').forEach(b => b.onclick = () => { toggleStar(b.dataset.star); render(); });
    const aiBtn = $('#ai-go');
    if (aiBtn) aiBtn.onclick = runAI;
  }

  function readFilters() {
    return {
      platforms: { polymarket: $('#f-poly').checked, kalshi: $('#f-kalshi').checked },
      bandLo: Math.min(Math.max(parseFloat($('#f-lo').value) || 70, 1), 98),
      bandHi: Math.min(Math.max(parseFloat($('#f-hi').value) || 80, 2), 99),
      minVolume24h: Math.max(0, parseFloat($('#f-vol').value) || 0),
      resolveWithinHours: parseInt($('#f-win').value, 10) || 0,
      depth: $('#f-depth').value,
      keyword: $('#f-kw').value.trim(),
      maxResults: SCStore.load().settings.filters.maxResults,
    };
  }

  async function runScan() {
    const s = SCStore.load();
    const f = readFilters();
    if (f.bandLo > f.bandHi) { const t = f.bandLo; f.bandLo = f.bandHi; f.bandHi = t; }
    if (!f.platforms.polymarket && !f.platforms.kalshi) {
      $('#scan-error').textContent = 'Pick at least one platform.';
      return;
    }
    s.settings.filters = f;
    SCStore.save();
    scanning = true; render();

    const status = {};
    const onProgress = (plat, n) => {
      status[plat] = n;
      const el = $('#scan-status');
      if (el) el.textContent = 'Fetching… ' + Object.keys(status).map(p => p + ': ' + status[p].toLocaleString() + ' markets').join(' · ');
    };
    const depth = SCConfig.DEPTHS[f.depth] || SCConfig.DEPTHS.standard;
    const proxy = s.settings.corsProxy;

    const jobs = [];
    if (f.platforms.polymarket) jobs.push(
      SCPlatforms.fetchPolymarket({ pages: depth.polymarketPages, resolveWithinHours: f.resolveWithinHours, proxy, onProgress })
        .then(raw => ({ plat: 'Polymarket', markets: SCScan.normalizePolymarket(raw) })));
    if (f.platforms.kalshi) jobs.push(
      SCPlatforms.fetchKalshi({ pages: depth.kalshiPages, resolveWithinHours: f.resolveWithinHours, proxy, onProgress })
        .then(raw => ({ plat: 'Kalshi', markets: SCScan.normalizeKalshi(raw) })));

    const settled = await Promise.allSettled(jobs);
    const markets = [];
    const errors = [];
    settled.forEach(r => {
      if (r.status === 'fulfilled') markets.push(...r.value.markets);
      else errors.push(r.reason && r.reason.message ? r.reason.message : String(r.reason));
    });

    scanning = false;
    if (!markets.length && errors.length) {
      render();
      $('#scan-error').textContent = errors.join('\n');
      return;
    }
    const candidates = SCScan.findCandidates(markets, f);
    s.lastScan = { when: Date.now(), params: f, scanned: markets.length, candidates };
    SCStore.save();
    render();
    if (errors.length) $('#scan-error').textContent = 'Partial scan — one platform failed:\n' + errors.join('\n');
  }

  async function runAI() {
    const s = SCStore.load();
    if (!s.lastScan || !s.lastScan.candidates.length) return;
    if (!s.settings.apiKey && !SCPlatforms.isMock()) {
      $('#ai-error').textContent = 'Add your Claude API key in Settings to use AI second opinions.';
      return;
    }
    const top = s.lastScan.candidates.slice(0, s.settings.aiTopN);
    aiBusy = true; render();
    try {
      const opinions = await SCAnalyzer.analyzeCandidates({
        apiKey: s.settings.apiKey, model: s.settings.model, candidates: top,
      });
      for (const c of s.lastScan.candidates) if (opinions[c.key]) c.ai = opinions[c.key];
      SCStore.save();
    } catch (err) {
      aiBusy = false; render();
      $('#ai-error').textContent = err.message;
      return;
    }
    aiBusy = false; render();
  }

  /* =========================== watchlist =========================== */

  function toggleStar(key) {
    const s = SCStore.load();
    const i = s.watchlist.findIndex(w => w.key === key);
    if (i >= 0) s.watchlist.splice(i, 1);
    else {
      const c = (s.lastScan ? s.lastScan.candidates : []).find(x => x.key === key);
      if (c) s.watchlist.push(Object.assign({}, c, { ai: c.ai || null, savedAt: Date.now(), savedProb: c.prob }));
    }
    SCStore.save();
  }

  function renderWatchlist() {
    const s = SCStore.load();
    $('#screen').innerHTML =
      '<div class="card-head-lone"><h2>Watchlist</h2>' +
        (s.watchlist.length ? '<button class="btn btn-sm" id="wl-refresh"' + (refreshing ? ' disabled' : '') + '>' +
          (refreshing ? 'Refreshing…' : '↻ Refresh prices') + '</button>' : '') + '</div>' +
      (s.watchlist.length
        ? s.watchlist.map(w => {
            const savedPct = Math.round(w.savedProb * 100);
            const nowPct = Math.round(w.prob * 100);
            const drift = nowPct - savedPct;
            const driftHtml = drift === 0 ? '<span class="muted">unchanged</span>'
              : '<span class="' + (drift > 0 ? 'good' : 'bad') + '">' + (drift > 0 ? '▲ +' : '▼ ') + drift + ' pts</span>';
            return '<div class="card cand">' +
              '<div class="cand-head">' +
                '<span class="chip plat-' + w.platform + '">' + (w.platform === 'polymarket' ? 'Polymarket' : 'Kalshi') + '</span>' +
                '<button class="btn btn-ghost btn-sm" data-unstar="' + esc(w.key) + '">✕</button>' +
              '</div>' +
              '<a class="cand-title" href="' + esc(w.url) + '" target="_blank" rel="noopener">' + esc(w.title) + ' ↗</a>' +
              '<div class="cand-prob-row"><span class="side-chip">' + esc(w.side) + '</span>' +
                '<span class="cand-prob">' + nowPct + '%</span>' + driftHtml + '</div>' +
              '<div class="cand-sub muted">saved at ' + savedPct + '% on ' +
                new Date(w.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
                ' · ' + timeUntil(w.closeTime) + '</div>' +
              '</div>';
          }).join('')
        : '<div class="card"><p class="muted">Nothing starred yet. Run a scan and tap ☆ on candidates you want to track — Scout remembers the price you saved them at so you can see drift.</p></div>');

    document.querySelectorAll('[data-unstar]').forEach(b => b.onclick = () => { toggleStar(b.dataset.unstar); render(); });
    const rf = $('#wl-refresh');
    if (rf) rf.onclick = refreshWatchlist;
  }

  async function refreshWatchlist() {
    const s = SCStore.load();
    refreshing = true; render();
    const fresh = await SCPlatforms.refreshCandidates(s.watchlist, s.settings.corsProxy);
    for (const w of s.watchlist) if (fresh[w.key] != null) w.prob = fresh[w.key];
    SCStore.save();
    refreshing = false; render();
  }

  /* ============================ settings =========================== */

  function renderSettings() {
    const s = SCStore.load();
    $('#screen').innerHTML =
      '<div class="card form-card"><div class="card-head"><h2>AI second opinion</h2></div>' +
        '<label>Claude API key<input id="st-key" type="password" value="' + esc(s.settings.apiKey) + '" placeholder="sk-ant-..." autocomplete="off"></label>' +
        '<label>Model<select id="st-model">' + SCConfig.MODELS.map(m =>
          '<option value="' + m.id + '"' + (m.id === s.settings.model ? ' selected' : '') + '>' + m.label + '</option>').join('') + '</select></label>' +
        '<label>Candidates per AI pass<input id="st-topn" type="number" min="1" max="25" value="' + s.settings.aiTopN + '"></label>' +
        '<p class="fineprint">Key is stored only in this browser\'s localStorage and sent only to api.anthropic.com. One pass over 10 markets costs a few cents. Price scanning itself needs no key at all.</p>' +
      '</div>' +
      '<div class="card form-card"><div class="card-head"><h2>Market data</h2></div>' +
        '<label>CORS proxy<input id="st-proxy" type="text" value="' + esc(s.settings.corsProxy) + '" placeholder="https://corsproxy.io/?url="></label>' +
        '<p class="fineprint">Scout calls Polymarket & Kalshi\'s public APIs directly from your browser. If a platform blocks cross-origin requests, the same call is retried through this proxy (the URL is appended, encoded). Clear it to disable the fallback.</p>' +
      '</div>' +
      '<div class="card form-card"><div class="card-head"><h2>Danger zone</h2></div>' +
        '<button class="btn" id="st-clear-scan">Clear scan results & watchlist</button>' +
        '<button class="btn" id="st-reset-all">Reset everything (incl. API key)</button>' +
      '</div>' +
      '<button class="btn btn-primary btn-lg" id="st-save">Save settings</button>';

    $('#st-save').onclick = () => {
      const sNow = SCStore.load();
      sNow.settings.apiKey = $('#st-key').value.trim();
      sNow.settings.model = $('#st-model').value;
      sNow.settings.aiTopN = Math.max(1, Math.min(25, parseInt($('#st-topn').value, 10) || SCConfig.AI_TOP_N));
      sNow.settings.corsProxy = $('#st-proxy').value.trim();
      SCStore.save();
      tab = 'scan'; render();
    };
    $('#st-clear-scan').onclick = () => {
      if (!confirm('Clear the last scan and your watchlist?')) return;
      const sNow = SCStore.load();
      sNow.lastScan = null; sNow.watchlist = [];
      SCStore.save(); render();
    };
    $('#st-reset-all').onclick = () => {
      if (confirm('Reset the entire app, including your API key?')) { SCStore.reset(); render(); }
    };
  }

  /* ============================= boot ============================= */

  render();
})();
