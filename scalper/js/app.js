/* Pulse — screens & wiring. The engine and sim never touch the DOM; this file
 * owns the interval loop, the live view, and persistence of trade records. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const MOCK = new URLSearchParams(location.search).get('mock') === '1';
  let tab = 'run';

  /* one active run at a time */
  let run = null, timer = null, runMeta = null;   // runMeta: { seed, scenarioId, speed }
  let series = null;                              // { t: [], price: [], liq: [], entryI, exitI }

  /* Blind labels: a stable shuffle for this browser session. */
  const mysteryOrder = SXSim.SCENARIO_IDS.slice().sort(() => Math.random() - 0.5);
  const mysteryName = id => 'Mystery token #' + (mysteryOrder.indexOf(id) + 1);
  const scenarioLabel = (id, revealed) => {
    const s = SXStore.load();
    return (s.settings.explicitLabels || revealed) ? SXSim.SCENARIOS[id].label : mysteryName(id);
  };

  const fmtSol = v => (v >= 0 ? '+' : '') + v.toFixed(4) + ' SOL';
  const fmtUsd = v => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2);
  const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const fmtPrice = p => (p * 1e9).toPrecision(4) + ' nSOL';
  const cls = v => v > 0 ? 'good' : v < 0 ? 'bad' : '';

  const REASON_TEXT = {
    TIMER_EXPIRED_PLAIN: 'No strong signal either way — the default timer exit fired on schedule.',
    TIMER_EXPIRED_EXT: 'Strong momentum extended the hold, then the extended timer cashed out near the top.',
    WEAK_MOMENTUM: 'Buying pressure faded — the engine cut the hold early instead of waiting for the timer.',
    EMERGENCY_LIQUIDITY_PULL: 'Liquidity was being pulled — sold instantly, slippage be damned.',
    EMERGENCY_WHALE_DUMP: 'A top holder started dumping — sold before the crowd caught on.',
    EMERGENCY_CONTRACT_RISK: 'A contract risk flag flipped on — sold immediately.',
    EMERGENCY_SELL_RESTRICTED: 'Selling became restricted (honeypot). The exit fired instantly but was blocked — position written off. The fixed timer fared no better.',
  };
  function reasonText(rec) {
    if (rec.exit.reason === 'TIMER_EXPIRED') {
      return rec.extensions.length ? REASON_TEXT.TIMER_EXPIRED_EXT : REASON_TEXT.TIMER_EXPIRED_PLAIN;
    }
    return REASON_TEXT[rec.exit.reason] || rec.exit.reason;
  }
  function reasonChip(reason, extensions) {
    const label = reason.replace('EMERGENCY_', '').replace(/_/g, ' ');
    const kind = reason.indexOf('EMERGENCY_') === 0 ? ' emergency'
      : reason === 'WEAK_MOMENTUM' ? ' weak' : extensions ? ' extend' : '';
    return '<span class="reason-chip' + kind + '">' + esc(label) + '</span>';
  }

  /* ============================= shell ============================= */

  function render() {
    const s = SXStore.load();
    if (!s.settings.onboarded) { renderOnboarding(); return; }
    app().innerHTML =
      '<header class="topbar">' +
        '<div class="brand">⚡ Pulse</div>' +
        '<div class="topbar-stats">' +
          (MOCK ? '<span class="chip chip-warn">mock</span>' : '') +
          '<span class="chip">paper only</span>' +
          '<span class="chip">' + s.trades.length + ' runs</span>' +
        '</div>' +
      '</header>' +
      '<main class="screen" id="screen"></main>' +
      '<nav class="tabbar">' + ['run', 'history', 'settings'].map(t =>
        '<button class="tabbtn' + (tab === t ? ' active' : '') + '" data-tab="' + t + '">' +
        { run: '⚡<span>Run</span>', history: '📒<span>History</span>', settings: '⚙️<span>Settings</span>' }[t] +
        '</button>').join('') +
      '</nav>';
    app().querySelectorAll('.tabbtn').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    ({ run: renderRun, history: renderHistory, settings: renderSettings })[tab]();
  }

  /* ========================== onboarding =========================== */

  function renderOnboarding() {
    app().innerHTML =
      '<main class="screen welcome">' +
        '<div class="logo-big">⚡</div>' +
        '<h1>Pulse</h1>' +
        '<p class="tagline">A paper-trading memecoin scalper with an adaptive smart exit: the hold timer is only the default — momentum, volume and liquidity decide whether to stretch the hold, cut it, or slam the exit.</p>' +
        '<div class="card notice">' +
          '<strong>Simulator only.</strong> Fomo has no public API, so nothing here touches real money or your Fomo account. Pulse is a training ground for exit discipline: every run pits the smart exit against a dumb fixed-timer exit on the same market so you can see exactly where the edge comes from. The market is synthetic (seeded and replayable) and the exit engine is a standalone module that could be pointed at a real feed later. Not financial advice.' +
        '</div>' +
        '<div class="card form-card">' +
          '<button class="btn btn-primary btn-lg" id="ob-go">Start simulating</button>' +
          '<p class="fineprint">Everything is stored only in this browser. No accounts, no keys, no network.</p>' +
        '</div>' +
      '</main>';
    $('#ob-go').onclick = () => {
      const s = SXStore.load();
      s.settings.onboarded = true;
      SXStore.save();
      render();
    };
  }

  /* ============================== run ============================== */

  function renderRun() {
    const running = !!(run && !run.finished());
    $('#screen').innerHTML =
      '<div class="card form-card">' +
        '<div class="card-head"><h2>Simulate a trade</h2><span class="card-sub">buy → smart exit vs fixed 4s timer</span></div>' +
        '<div class="form-grid">' +
          '<label>Market<select id="r-scen"' + (running ? ' disabled' : '') + '>' +
            SXSim.SCENARIO_IDS.map(id =>
              '<option value="' + id + '">' + esc(scenarioLabel(id, false)) + '</option>').join('') +
          '</select></label>' +
          '<label>Seed <span class="hint">(blank = random)</span>' +
            '<input id="r-seed" type="number" placeholder="random"' + (running ? ' disabled' : '') +
            (MOCK ? ' value="' + SXConfig.MOCK.seed + '"' : '') + '></label>' +
        '</div>' +
        '<div class="row-gap"><span class="hint">Speed</span><div class="seg" id="r-speed">' +
          SXConfig.SPEEDS.map((sp, i) => '<button class="btn btn-sm' + (i === 0 ? ' active' : '') +
            '" data-mult="' + sp.mult + '">' + sp.label + '</button>').join('') +
        '</div></div>' +
        '<button class="btn btn-primary btn-lg" id="r-go">' + (running ? '⏹ Stop' : '▶ Start run') + '</button>' +
      '</div>' +
      '<div class="card" id="live" style="display:' + (run ? 'flex' : 'none') + '">' +
        '<div class="card-head"><h2 id="lv-name"></h2><span class="price-big" id="lv-price"></span></div>' +
        '<div class="spark-wrap"><canvas class="spark" id="lv-spark"></canvas></div>' +
        '<div class="hold-row"><span id="lv-held"></span><span id="lv-pnl"></span><span id="lv-deadline"></span></div>' +
        '<div class="hold-track" id="lv-track"><div class="hold-fill" id="lv-fill"></div></div>' +
        '<div class="gauges" id="lv-gauges"></div>' +
        '<div class="banner hold" id="lv-banner">warming up…</div>' +
        '<div class="feed" id="lv-feed"></div>' +
      '</div>' +
      '<div id="result"></div>' +
      (run ? '' :
        '<div class="card"><p class="muted">Pick a market and hit <strong>Start run</strong>. ' +
        'The bot buys after 1s and would normally sell 4s later — but the smart exit watches momentum, ' +
        'volume and liquidity every 250ms and decides whether the timer, an extension, or an emergency ' +
        'gets the final word. Some mystery markets are healthy; some are traps.</p></div>');

    if (MOCK) $('#r-scen').value = SXConfig.MOCK.scenario;
    $('#r-speed').querySelectorAll('button').forEach(b => b.onclick = () => {
      $('#r-speed').querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (run && !run.finished()) startTimer(Number(b.dataset.mult));
    });
    $('#r-go').onclick = () => {
      if (run && !run.finished()) { stopRun('stopped early — run discarded'); return; }
      startRun();
    };
    if (run) { renderLive(); if (run.finished()) renderResult(); }
  }

  function speedMult() {
    const b = $('#r-speed') && $('#r-speed').querySelector('.active');
    return b ? Number(b.dataset.mult) : 1;
  }

  function startRun() {
    const scenarioId = $('#r-scen').value;
    const seedRaw = $('#r-seed').value.trim();
    const seed = MOCK ? SXConfig.MOCK.seed
      : seedRaw !== '' ? (Number(seedRaw) >>> 0) : Math.floor(Math.random() * 2 ** 31);
    const s = SXStore.load();
    run = SXTrader.createRun({
      scenarioId, seed, tickMs: SXConfig.TICK_MS, simCfg: SXConfig.SIM,
      exitCfg: SXStore.exitConfig(),
      trade: { buySizeSol: Number(s.settings.buySizeSol) || 0.5, entryDelayMs: SXConfig.TRADE.entryDelayMs },
      solUsd: Number(s.settings.solUsd) || SXConfig.SOL_USD,
    });
    runMeta = { seed, scenarioId };
    series = { t: [], price: [], liq: [], entryI: -1, exitI: -1 };
    $('#result').innerHTML = '';
    $('#live').style.display = 'flex';
    $('#r-go').textContent = '⏹ Stop';
    $('#r-scen').disabled = true; $('#r-seed').disabled = true;
    startTimer(speedMult());
  }

  function startTimer(mult) {
    if (timer) clearInterval(timer);
    timer = setInterval(tickOnce, SXConfig.TICK_MS / mult);
  }

  function stopRun(msg) {
    if (timer) { clearInterval(timer); timer = null; }
    run = null; runMeta = null; series = null;
    if (tab === 'run' && $('#screen')) {
      renderRun();
      if (msg) { const b = $('#lv-banner'); if (b) b.textContent = msg; }
    }
  }

  function tickOnce() {
    if (!run) return;
    const out = run.step();
    if (!out) { finishRun(); return; }
    const st = run.state();
    series.t.push(st.t);
    series.price.push(st.tick.price);
    series.liq.push(st.tick.pool.quote);
    if (st.position && series.entryI < 0) series.entryI = series.t.length - 1;
    if (st.exit && series.exitI < 0) series.exitI = series.t.length - 1;
    if (tab === 'run') renderLive();
    if (out.finished) finishRun();
  }

  function finishRun() {
    if (timer) { clearInterval(timer); timer = null; }
    if (!run) return;
    const rec = run.result();
    if (rec) {
      const s = SXStore.load();
      s.trades.unshift(Object.assign({ id: SXStore.uid(), ts: Date.now() }, rec));
      if (s.trades.length > SXConfig.HISTORY_CAP) s.trades.length = SXConfig.HISTORY_CAP;
      SXStore.save();
    }
    if (tab === 'run') { renderLive(); renderResult(); }
  }

  /* ---------------------------- live view ---------------------------- */

  function gauge(label, val, state) {
    return '<div class="gauge ' + state + '"><span class="g-val">' + val + '</span>' +
      '<span class="g-label">' + label + '</span></div>';
  }

  function renderLive() {
    if (!run || !$('#live')) return;
    const st = run.state();
    const g = st.gauges;
    const ec = SXStore.exitConfig();

    $('#lv-name').textContent = scenarioLabel(runMeta.scenarioId, !!st.exit) +
      ' · seed ' + runMeta.seed;
    $('#lv-price').textContent = st.tick ? fmtPrice(st.tick.price) : '—';

    /* hold bar */
    if (st.position) {
      const dl = st.holdDeadline;
      const frac = Math.max(0, Math.min(1, (st.t - st.position.t) / Math.max(1, dl - st.position.t)));
      $('#lv-fill').style.width = (st.exit ? 100 : frac * 100) + '%';
      $('#lv-held').textContent = 'held ' + ((st.t - st.position.t) / 1000).toFixed(2) + 's';
      $('#lv-deadline').textContent = st.exit ? 'exited' :
        'timer at ' + ((dl - st.position.t) / 1000).toFixed(1) + 's' +
        (g.extensionsUsed ? ' (+' + g.extensionsUsed + ' ext)' : '');
      const held = st.tick.price * st.position.sizeBase - st.position.costQuote;
      const pnl = st.exit ? (st.exit.proceedsQuote || 0) - st.position.costQuote : held;
      $('#lv-pnl').innerHTML = '<span class="' + cls(pnl) + '">' + fmtSol(pnl) + '</span>';
    } else {
      $('#lv-fill').style.width = '0%';
      $('#lv-held').textContent = 'waiting to enter…';
      $('#lv-deadline').textContent = ''; $('#lv-pnl').textContent = '';
    }

    /* gauges: velocity, buy ratio, volume accel, expected impact */
    const vel = g.velPctPerSec, ratio = g.buyVolRatio * 100, acc = g.volAccel, imp = g.impactPct;
    $('#lv-gauges').innerHTML =
      gauge('vel %/s', (vel >= 0 ? '+' : '') + vel.toFixed(1),
        vel >= ec.strongVelPctPerSec ? 'ok' : vel <= ec.weakVelPctPerSec ? 'bad' : '') +
      gauge('buy %', ratio.toFixed(0),
        g.buyVolRatio >= ec.strongBuyRatio ? 'ok' : g.buyVolRatio <= ec.weakBuyRatio ? 'bad' : '') +
      gauge('vol ×', acc.toFixed(2),
        acc >= ec.strongVolAccel ? 'ok' : acc <= ec.weakVolAccel ? 'bad' : '') +
      gauge('impact %', imp.toFixed(1),
        imp > ec.maxImpactPct ? 'bad' : imp > ec.maxImpactPct / 2 ? 'warn' : 'ok');

    /* banner */
    const banner = $('#lv-banner');
    if (st.aborted) { banner.className = 'banner exit-warn'; banner.textContent = 'market broken before entry — no trade'; }
    else if (!st.position) { banner.className = 'banner hold'; banner.textContent = 'warming up…'; }
    else if (st.exit) {
      const em = st.exit.reason.indexOf('EMERGENCY_') === 0;
      const pnl = (st.exit.proceedsQuote || 0) - st.position.costQuote;
      banner.className = 'banner ' + (st.exit.failed ? 'exit-bad' : em ? 'exit-warn' : pnl >= 0 ? 'exit-good' : 'exit-bad');
      banner.textContent = st.exit.reason.replace('EMERGENCY_', '⚠ ').replace(/_/g, ' ');
    } else if (g.momentum === 'strong') { banner.className = 'banner extend'; banner.textContent = 'strong momentum — riding it'; }
    else { banner.className = 'banner hold'; banner.textContent = 'holding · momentum ' + g.momentum; }

    /* feed */
    $('#lv-feed').innerHTML = st.events.slice(-30).map(e =>
      '<div class="feed-line"><span class="t">' + (e.t / 1000).toFixed(2) + 's</span>' +
      esc(e.text) + '</div>').join('');

    drawSpark();
  }

  function drawSpark() {
    const cv = $('#lv-spark');
    if (!cv || !series || series.price.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const n = series.price.length;
    const pad = 4 * dpr;
    const x = i => pad + (w - 2 * pad) * (i / Math.max(1, n - 1));
    const line = (arr, color, width, alpha) => {
      let lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr);
      if (hi - lo < 1e-12) { hi += 1e-12; lo -= 1e-12; }
      const y = v => h - pad - (h - 2 * pad) * ((v - lo) / (hi - lo));
      ctx.beginPath();
      ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.globalAlpha = alpha;
      for (let i = 0; i < n; i++) i ? ctx.lineTo(x(i), y(arr[i])) : ctx.moveTo(x(i), y(arr[i]));
      ctx.stroke(); ctx.globalAlpha = 1;
      return y;
    };
    line(series.liq, css.getPropertyValue('--spark-liq').trim() || '#3987e5', 1, 0.35);
    const yP = line(series.price, css.getPropertyValue('--spark-line').trim() || '#e0a72e', 2, 1);
    const dot = (i, color) => {
      if (i < 0) return;
      ctx.beginPath(); ctx.fillStyle = color;
      ctx.arc(x(i), yP(series.price[i]), 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
    };
    dot(series.entryI, css.getPropertyValue('--good').trim() || '#21c06d');
    dot(series.exitI, css.getPropertyValue('--bad').trim() || '#e66767');
  }

  function renderResult() {
    if (!run || !$('#result')) return;
    const rec = SXStore.load().trades[0];
    const st = run.state();
    if (st.aborted || !rec) {
      $('#result').innerHTML = '<div class="card"><p class="muted">No trade this run.</p></div>';
      return;
    }
    const b = rec.baseline;
    $('#result').innerHTML =
      '<div class="card">' +
        '<div class="card-head"><h2>Result — ' + esc(SXSim.SCENARIOS[rec.scenarioId].label) + '</h2>' +
          reasonChip(rec.exit.reason, rec.extensions.length) + '</div>' +
        '<div class="result-grid">' +
          '<div class="result-cell"><div class="r-label">smart exit · ' + ((rec.exit.t - rec.entry.t) / 1000).toFixed(2) + 's held</div>' +
            '<div class="r-val ' + cls(rec.pnlQuote) + '">' + fmtPct(rec.pnlPct) + '</div>' +
            '<div class="muted">' + fmtSol(rec.pnlQuote) + ' · ' + fmtUsd(rec.pnlUsd) + '</div></div>' +
          '<div class="result-cell"><div class="r-label">fixed ' + (SXStore.exitConfig().baseHoldMs / 1000) + 's timer</div>' +
            '<div class="r-val ' + cls(b.pnlQuote) + '">' + fmtPct(b.pnlPct) + '</div>' +
            '<div class="muted">' + fmtSol(b.pnlQuote) + (b.failed ? ' · stuck' : '') + '</div></div>' +
        '</div>' +
        '<div class="edge-line ' + cls(rec.edgeQuote) + '">edge vs timer: ' + fmtSol(rec.edgeQuote) +
          ' (' + fmtUsd(rec.edgeUsd) + ')</div>' +
        '<p class="card-sub">' + esc(reasonText(rec)) +
          (rec.extensions.length ? ' Extended ' + rec.extensions.length + '×.' : '') + '</p>' +
        '<button class="btn" id="res-again">Run another</button>' +
      '</div>';
    $('#res-again').onclick = () => { run = null; runMeta = null; series = null; renderRun(); };
  }

  /* ============================ history ============================ */

  function renderHistory() {
    const s = SXStore.load();
    const tr = s.trades;
    if (!tr.length) {
      $('#screen').innerHTML = '<div class="card"><p class="muted">No runs yet. Trades land here with their smart-vs-timer comparison.</p></div>';
      return;
    }
    const sum = k => tr.reduce((a, x) => a + x[k], 0);
    const smartQ = sum('pnlQuote');
    const baseQ = tr.reduce((a, x) => a + x.baseline.pnlQuote, 0);
    const edgeQ = sum('edgeQuote');
    const emergencies = tr.filter(x => x.exit.reason.indexOf('EMERGENCY_') === 0).length;
    $('#screen').innerHTML =
      '<div class="card">' +
        '<div class="card-head"><h2>Scoreboard</h2><span class="card-sub">' + tr.length + ' runs</span></div>' +
        '<div class="agg">' +
          '<div><div class="a-val ' + cls(smartQ) + '">' + fmtSol(smartQ) + '</div><div class="a-label">smart exit</div></div>' +
          '<div><div class="a-val ' + cls(baseQ) + '">' + fmtSol(baseQ) + '</div><div class="a-label">fixed timer</div></div>' +
          '<div><div class="a-val ' + cls(edgeQ) + '">' + fmtSol(edgeQ) + '</div><div class="a-label">edge</div></div>' +
          '<div><div class="a-val">' + emergencies + '</div><div class="a-label">emergencies</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card">' + tr.map(x =>
        '<div class="trade-row">' +
          '<div class="trade-top"><span class="trade-title">' + esc(SXSim.SCENARIOS[x.scenarioId] ?
            SXSim.SCENARIOS[x.scenarioId].label : x.scenarioId) + '</span>' +
            reasonChip(x.exit.reason, x.extensions.length) + '</div>' +
          '<div class="trade-sub"><span>smart <b class="' + cls(x.pnlQuote) + '">' + fmtPct(x.pnlPct) + '</b>' +
            ' · timer <b class="' + cls(x.baseline.pnlQuote) + '">' + fmtPct(x.baseline.pnlPct) + '</b></span>' +
            '<span>edge <b class="' + cls(x.edgeQuote) + '">' + fmtUsd(x.edgeUsd) + '</b></span></div>' +
        '</div>').join('') +
      '</div>';
  }

  /* ============================ settings =========================== */

  const TUNABLES = [
    ['baseHoldMs', 'Default hold (ms)'],
    ['maxHoldMs', 'Max hold (ms)'],
    ['extendStepMs', 'Extension step (ms)'],
    ['strongVelPctPerSec', 'Strong velocity (%/s)'],
    ['weakVelPctPerSec', 'Weak velocity (%/s)'],
    ['strongBuyRatio', 'Strong buy ratio'],
    ['weakBuyRatio', 'Weak buy ratio'],
    ['strongVolAccel', 'Strong vol accel (×)'],
    ['maxImpactPct', 'Max sell impact (%)'],
    ['liqPullPct', 'Liquidity-pull alarm (%)'],
    ['whaleHolderPct', 'Whale holder (%)'],
    ['whaleSellPortion', 'Whale dump portion'],
  ];

  function renderSettings() {
    const s = SXStore.load();
    const ec = SXStore.exitConfig();
    $('#screen').innerHTML =
      '<div class="card form-card">' +
        '<h2>Trade</h2>' +
        '<div class="form-grid">' +
          '<label>Buy size (SOL)<input id="st-size" type="number" step="0.1" min="0.05" value="' + s.settings.buySizeSol + '"></label>' +
          '<label>SOL price ($)<input id="st-usd" type="number" step="1" min="1" value="' + s.settings.solUsd + '"></label>' +
        '</div>' +
        '<label class="check"><input type="checkbox" id="st-labels"' + (s.settings.explicitLabels ? ' checked' : '') + '> Show real scenario names before the run ends</label>' +
      '</div>' +
      '<div class="card form-card">' +
        '<div class="card-head"><h2>Exit engine thresholds</h2><span class="card-sub">defaults are tuned to the sim</span></div>' +
        '<div class="form-grid">' + TUNABLES.map(([k, label]) =>
          '<label>' + label + '<input data-k="' + k + '" class="st-exit" type="number" step="any" value="' + ec[k] + '"></label>').join('') +
        '</div>' +
        '<div class="row-gap">' +
          '<button class="btn btn-primary" id="st-save">Save settings</button>' +
          '<button class="btn" id="st-defaults">Reset thresholds</button>' +
          '<button class="btn btn-ghost" id="st-wipe">Reset all data</button>' +
        '</div>' +
        '<div id="st-msg" class="muted"></div>' +
        '<p class="fineprint">Pulse is a simulator. The exit engine (scalper/js/exit.js) is feed-agnostic — these same thresholds would drive it on a real tick stream.</p>' +
      '</div>';

    $('#st-save').onclick = () => {
      const st = SXStore.load().settings;
      st.buySizeSol = Number($('#st-size').value) || 0.5;
      st.solUsd = Number($('#st-usd').value) || SXConfig.SOL_USD;
      st.explicitLabels = $('#st-labels').checked;
      const over = {};
      document.querySelectorAll('.st-exit').forEach(inp => {
        const v = Number(inp.value);
        if (isFinite(v) && v !== SXConfig.EXIT[inp.dataset.k]) over[inp.dataset.k] = v;
      });
      st.exitOverrides = over;
      SXStore.save();
      $('#st-msg').textContent = 'Saved.';
    };
    $('#st-defaults').onclick = () => {
      SXStore.load().settings.exitOverrides = {};
      SXStore.save();
      renderSettings();
    };
    $('#st-wipe').onclick = () => {
      if (confirm('Wipe all Pulse data (settings + trade history)?')) { SXStore.reset(); render(); }
    };
  }

  render();
})();
