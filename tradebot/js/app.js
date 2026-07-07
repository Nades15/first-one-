/* MFFU Trade Copilot — screens & wiring. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');
  let tab = 'analyze';
  let chartBlob = null;         // current pasted/uploaded screenshot
  let chartPreviewUrl = null;
  let lastResult = null;        // last validated signal + audit
  let analyzing = false;
  let journalPrefill = null;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt$ = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const fmtPx = n => n === null || n === undefined ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 });

  /* ============================= shell ============================= */

  function render() {
    const s = TBStore.load();
    if (!s.settings.onboarded) { renderOnboarding(); return; }
    const snap = TBJournal.snapshot();
    app().innerHTML =
      '<header class="topbar">' +
        '<div class="brand">📈 Trade Copilot</div>' +
        '<div class="topbar-stats">' +
          '<span class="chip ' + (snap.dist <= 0 ? 'chip-bad' : snap.dist < snap.plan.maxLoss * 0.4 ? 'chip-warn' : '') + '">buffer ' + fmt$(Math.max(0, snap.dist)) + '</span>' +
          '<span class="chip">' + fmt$(snap.balance) + '</span>' +
        '</div>' +
      '</header>' +
      '<main class="screen" id="screen"></main>' +
      '<nav class="tabbar">' + ['analyze', 'account', 'journal', 'settings'].map(t =>
        '<button class="tabbtn' + (tab === t ? ' active' : '') + '" data-tab="' + t + '">' +
        { analyze: '🎯<span>Analyze</span>', account: '🛡️<span>Account</span>', journal: '📓<span>Journal</span>', settings: '⚙️<span>Settings</span>' }[t] +
        '</button>').join('') +
      '</nav>';
    app().querySelectorAll('.tabbtn').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    ({ analyze: renderAnalyze, account: renderAccount, journal: renderJournal, settings: renderSettings })[tab](snap);
  }

  /* ========================== onboarding =========================== */

  function renderOnboarding() {
    const s = TBStore.load();
    app().innerHTML =
      '<main class="screen welcome">' +
        '<div class="logo-big">📈</div>' +
        '<h1>MFFU Trade Copilot</h1>' +
        '<p class="tagline">Paste a chart screenshot, get a disciplined LONG / SHORT / NO-TRADE read with stops and targets — plus a rules guardian that knows exactly how close your MyFundedFutures 25k account is to a breach.</p>' +
        '<div class="card notice">' +
          '<strong>Read this once:</strong> no AI can see order flow or news in a screenshot, and nothing can guarantee you pass an evaluation. This tool\'s real edge is discipline — honest NO-TRADE calls, position sizing from your remaining drawdown, and rule tracking. It is decision support, not financial advice. You own every trade.' +
        '</div>' +
        '<div class="card form-card">' +
          '<label>Your MFFU 25k plan' +
            '<select id="ob-plan">' + Object.values(TBConfig.PLANS).map(p =>
              '<option value="' + p.id + '"' + (p.id === s.settings.planId ? ' selected' : '') + '>' + p.label + '</option>').join('') +
            '</select></label>' +
          '<label>Claude API key <span class="hint">(from console.anthropic.com — stays on this device)</span>' +
            '<input id="ob-key" type="password" placeholder="sk-ant-..." autocomplete="off"></label>' +
          '<button class="btn btn-primary btn-lg" id="ob-go">Start</button>' +
          '<p class="fineprint">You can change everything later in Settings. Plan numbers are presets — verify them against your MFFU dashboard.</p>' +
        '</div>' +
      '</main>';
    $('#ob-go').onclick = () => {
      s.settings.planId = $('#ob-plan').value;
      s.settings.apiKey = $('#ob-key').value.trim();
      s.settings.onboarded = true;
      const p = TBConfig.PLANS[s.settings.planId];
      s.account.balance = p.startBalance;
      TBStore.save();
      render();
    };
  }

  /* ============================ analyze ============================ */

  function renderAnalyze(snap) {
    const s = TBStore.load();
    const instr = TBConfig.INSTRUMENTS;
    $('#screen').innerHTML =
      (snap.breached ? '<div class="banner banner-bad">⛔ Balance is at/below your Max Loss Limit. If this matches your MFFU dashboard, this account is breached.</div>' : '') +
      '<div class="card">' +
        '<div class="card-head"><h2>Chart analysis</h2><span class="card-sub">paste (Ctrl+V) or upload a screenshot</span></div>' +
        '<label class="field-inline">Instrument ' +
          '<select id="an-instr">' + Object.keys(instr).map(k =>
            '<option value="' + k + '"' + (k === s.settings.defaultInstrument ? ' selected' : '') + '>' + instr[k].label + '</option>').join('') +
          '</select></label>' +
        '<div id="dropzone" class="dropzone' + (chartPreviewUrl ? ' has-img' : '') + '">' +
          (chartPreviewUrl
            ? '<img src="' + chartPreviewUrl + '" alt="chart">'
            : '<div class="dz-hint">🖼️ Tap to upload<br><span>or paste a screenshot anywhere on this page</span></div>') +
        '</div>' +
        '<input type="file" id="an-file" accept="image/*" hidden>' +
        '<div class="row-gap">' +
          '<button class="btn btn-primary btn-lg" id="an-go"' + (chartBlob && !analyzing ? '' : ' disabled') + '>' +
            (analyzing ? 'Analyzing…' : 'Analyze chart') + '</button>' +
          (chartBlob ? '<button class="btn btn-ghost" id="an-clear">Clear</button>' : '') +
        '</div>' +
        '<div id="an-error" class="error-text"></div>' +
      '</div>' +
      '<div id="an-result">' + (lastResult ? '' : recentSignalsHTML()) + '</div>';

    const dz = $('#dropzone');
    dz.onclick = () => $('#an-file').click();
    $('#an-file').onchange = e => { if (e.target.files[0]) setChart(e.target.files[0]); };
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = e => {
      e.preventDefault(); dz.classList.remove('drag');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) setChart(f);
    };
    const clearBtn = $('#an-clear');
    if (clearBtn) clearBtn.onclick = () => { clearChart(); render(); };
    $('#an-go').onclick = runAnalysis;
    if (lastResult) renderResultCard(snap);
  }

  function setChart(blob) {
    clearChart();
    chartBlob = blob;
    chartPreviewUrl = URL.createObjectURL(blob);
    lastResult = null;
    render();
  }

  function clearChart() {
    if (chartPreviewUrl) URL.revokeObjectURL(chartPreviewUrl);
    chartBlob = null; chartPreviewUrl = null; lastResult = null;
  }

  async function runAnalysis() {
    const s = TBStore.load();
    const symbol = $('#an-instr').value;
    const instrument = Object.assign({ symbol }, TBConfig.INSTRUMENTS[symbol]);
    analyzing = true; render();
    try {
      const sig = await TBAnalyzer.analyze({
        apiKey: s.settings.apiKey,
        model: s.settings.model,
        imageBlob: chartBlob,
        instrument,
        accountContext: TBJournal.accountContextText(),
      });
      lastResult = { sig, symbol };
      TBJournal.saveSignal(sig, symbol, s.settings.model);
    } catch (err) {
      lastResult = null;
      analyzing = false; render();
      $('#an-error').textContent = err.message;
      return;
    }
    analyzing = false;
    s.settings.defaultInstrument = symbol; TBStore.save();
    render();
  }

  function renderResultCard(snap) {
    const { sig, symbol } = lastResult;
    const instrument = Object.assign({ symbol }, TBConfig.INSTRUMENTS[symbol]);
    const s = TBStore.load();
    let audit = null;
    if (sig.signal !== 'NO_TRADE') {
      audit = TBRules.preTradeCheck({
        plan: snap.plan, balance: snap.balance, floor: snap.floor,
        riskPct: s.settings.riskPct, entry: sig.entry, stopLoss: sig.stopLoss,
        instrument, dayPnls: TBJournal.dayPnls(),
      });
    }
    const cls = sig.signal === 'LONG' ? 'sig-long' : sig.signal === 'SHORT' ? 'sig-short' : 'sig-none';
    const icon = sig.signal === 'LONG' ? '▲' : sig.signal === 'SHORT' ? '▼' : '⏸';
    let html =
      '<div class="card result ' + cls + '">' +
        '<div class="sig-head"><span class="sig-badge">' + icon + ' ' + sig.signal.replace('_', ' ') + '</span>' +
        '<span class="sig-conf">' + sig.confidence + '% confidence · ' + esc(sig.timeframe || '') + '</span></div>';

    if (sig.signal === 'NO_TRADE') {
      html += '<p class="sig-text">' + esc(sig.rationale) + '</p>' +
        (sig.risks ? '<p class="sig-sub"><strong>Notes:</strong> ' + esc(sig.risks) + '</p>' : '') +
        '<p class="sig-sub good-note">Standing aside costs $0. That is how evaluations get passed.</p>';
    } else {
      const rows = [
        ['Entry', fmtPx(sig.entry)], ['Stop loss', fmtPx(sig.stopLoss)],
        ['TP 1', fmtPx(sig.tp1)], ['TP 2', fmtPx(sig.tp2)],
      ];
      html += '<div class="px-grid">' + rows.map(r =>
        '<div class="px-cell"><span class="px-label">' + r[0] + '</span><span class="px-val">' + r[1] + '</span></div>').join('') + '</div>';

      if (audit) {
        if (audit.verdict === 'block') {
          html += '<div class="banner banner-bad">⛔ DON\'T TAKE THIS TRADE<br><span>' + audit.reasons.map(esc).join('<br>') + '</span></div>';
        } else {
          const sz = audit.sizing;
          html += '<div class="size-box' + (audit.verdict === 'reduce' ? ' warn' : '') + '">' +
            '<div class="size-main">Size: <strong>' + sz.contracts + '× ' + symbol + '</strong> · risking ' + fmt$(sz.riskDollars) + ' (' + audit.slTicks + ' ticks)</div>' +
            '<div class="size-sub">' + fmt$(sz.perContractRisk) + '/contract · buffer ' + fmt$(audit.dist) + ' · budget ' + s.settings.riskPct + '%' +
            (sz.capReason === 'plan-limit' ? ' · capped by plan limit (' + sz.cap + ')' : '') + '</div>' +
            (audit.reasons.length ? '<div class="size-warnings">⚠ ' + audit.reasons.map(esc).join('<br>⚠ ') + '</div>' : '') +
            '</div>';
          if (sig.tp1 !== null && audit.slTicks) {
            const rr = Math.abs(sig.tp1 - sig.entry) / Math.abs(sig.entry - sig.stopLoss);
            html += '<div class="size-sub rr">Reward:risk to TP1 ≈ ' + rr.toFixed(1) + 'R' + (rr < 1.5 ? ' — thin. Skipping is reasonable.' : '') + '</div>';
          }
        }
      }
      html += '<p class="sig-text"><strong>Why:</strong> ' + esc(sig.rationale) + '</p>' +
        '<p class="sig-sub"><strong>Invalidation:</strong> ' + esc(sig.invalidation) + '</p>' +
        '<p class="sig-sub"><strong>Can\'t see:</strong> ' + esc(sig.risks) + '</p>';
      if (!audit || audit.verdict !== 'block') {
        html += '<button class="btn" id="an-log">📓 Log to journal</button>';
      }
    }
    html += '<p class="fineprint">AI chart read — not financial advice. Check levels against your own platform before acting.</p></div>';
    $('#an-result').innerHTML = html;
    const logBtn = $('#an-log');
    if (logBtn) logBtn.onclick = () => {
      journalPrefill = {
        instrument: symbol, dir: sig.signal, entry: sig.entry,
        contracts: audit && audit.sizing ? audit.sizing.contracts : 1,
      };
      tab = 'journal'; render();
    };
  }

  function recentSignalsHTML() {
    const sigs = TBStore.load().signals;
    if (!sigs.length) return '';
    return '<div class="card"><div class="card-head"><h2>Recent reads</h2></div>' +
      sigs.slice(0, 5).map(r =>
        '<div class="recent-row"><span class="sig-mini ' + (r.sig.signal === 'LONG' ? 'sig-long' : r.sig.signal === 'SHORT' ? 'sig-short' : 'sig-none') + '">' +
        r.sig.signal.replace('_', ' ') + '</span> ' + esc(r.instrument) +
        ' <span class="muted">' + new Date(r.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · ' + r.sig.confidence + '%</span></div>').join('') +
      '</div>';
  }

  /* ============================ account ============================ */

  function renderAccount(snap) {
    const s = TBStore.load();
    const p = snap.plan;
    const distPct = Math.max(0, Math.min(1, snap.dist / p.maxLoss));
    const todayClosed = s.account.days.some(d => d.date === TBStore.todayISO());
    const consHtml = snap.cons.applies
      ? '<div class="stat-tile"><span class="stat-label">Consistency (max ' + p.consistencyPct + '%)</span>' +
        '<span class="stat-value ' + (snap.cons.ok ? '' : 'bad') + '">' + (snap.cons.total > 0 ? Math.round(snap.cons.ratio * 100) + '%' : '—') + '</span>' +
        '<span class="stat-sub">' + (snap.cons.ok ? 'best day ' + fmt$(snap.cons.bestDay) :
          'need ' + fmt$(Math.ceil(snap.cons.requiredTotal)) + ' total before finishing') + '</span></div>'
      : '';

    $('#screen').innerHTML =
      '<div class="card-head-lone"><h2>' + esc(p.label) + '</h2><span class="card-sub">' + snap.tradingDays + '/' + p.minTradingDays + ' trading days</span></div>' +
      (snap.breached ? '<div class="banner banner-bad">⛔ At/below Max Loss Limit.</div>' : '') +
      (snap.target.hit ? '<div class="banner banner-good">🎉 Profit target hit' + (snap.cons.applies && !snap.cons.ok ? ' — but the consistency rule is not yet satisfied.' : '! Confirm on your MFFU dashboard.') + '</div>' : '') +
      '<div class="stat-row">' +
        '<div class="stat-tile"><span class="stat-label">Balance</span><span class="stat-value">' + fmt$(snap.balance) + '</span>' +
          '<span class="stat-sub"><a href="#" id="ac-sync">sync with dashboard</a></span></div>' +
        '<div class="stat-tile"><span class="stat-label">Max Loss Limit</span><span class="stat-value">' + fmt$(snap.floor) + '</span>' +
          '<span class="stat-sub">' + (snap.floorLocked ? '🔒 locked' : 'trails your EOD balance') + '</span></div>' +
        '<div class="stat-tile"><span class="stat-label">Buffer to breach</span><span class="stat-value ' + (snap.dist < p.maxLoss * 0.4 ? 'bad' : 'good') + '">' + fmt$(Math.max(0, snap.dist)) + '</span>' +
          '<div class="meter"><div class="meter-fill' + (distPct < 0.4 ? ' low' : '') + '" style="width:' + Math.round(distPct * 100) + '%"></div></div></div>' +
        '<div class="stat-tile"><span class="stat-label">Target ' + fmt$(p.profitTarget) + '</span><span class="stat-value">' + fmt$(Math.max(0, snap.target.profit)) + '</span>' +
          '<div class="meter"><div class="meter-fill target" style="width:' + Math.round(snap.target.pct * 100) + '%"></div></div></div>' +
        '<div class="stat-tile"><span class="stat-label">Today\'s P&L</span><span class="stat-value ' + (snap.todayPnl > 0 ? 'good' : snap.todayPnl < 0 ? 'bad' : '') + '">' + fmt$(snap.todayPnl) + '</span>' +
          (snap.todayPnl < -0.25 * snap.dist && snap.todayPnl < 0 ? '<span class="stat-sub bad">consider stopping for today</span>' : '<span class="stat-sub">&nbsp;</span>') + '</div>' +
        consHtml +
      '</div>' +
      '<div class="card">' +
        '<div class="card-head"><h2>End of day</h2><span class="card-sub">rolls the trailing Max Loss Limit</span></div>' +
        '<p class="sig-sub">When you\'re done trading, close the day. Your MLL becomes max(current, EOD balance − ' + fmt$(p.maxLoss) + '), locking at ' + fmt$(p.startBalance + p.lockBuffer) + '.</p>' +
        '<div class="row-gap">' +
        (todayClosed
          ? '<span class="chip chip-good">day closed ✓</span><button class="btn btn-sm" id="ac-undo">undo</button>'
          : '<button class="btn btn-primary" id="ac-eod">End my day at ' + fmt$(snap.balance) + '</button>') +
        '</div>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h2>Day history</h2></div>' +
        (s.account.days.length
          ? '<table class="mini-table"><tr><th>Date</th><th>P&L</th><th>Close</th></tr>' +
            s.account.days.slice().reverse().map(d =>
              '<tr><td>' + d.date + '</td><td class="' + (d.pnl > 0 ? 'good' : d.pnl < 0 ? 'bad' : '') + '">' + fmt$(d.pnl) + '</td><td>' + fmt$(d.endBalance) + '</td></tr>').join('') + '</table>'
          : '<p class="muted">No completed days yet.</p>') +
      '</div>' +
      '<p class="fineprint">Rule numbers are presets you can edit in Settings. Your MFFU dashboard is always the source of truth — this tracker exists so you never get surprised by it.</p>';

    $('#ac-sync').onclick = e => {
      e.preventDefault();
      const v = prompt('Current balance from your MFFU dashboard:', snap.balance);
      if (v !== null && !isNaN(parseFloat(v))) { TBJournal.setBalance(parseFloat(v)); render(); }
    };
    const eod = $('#ac-eod'); if (eod) eod.onclick = () => { TBJournal.endDay(); render(); };
    const undo = $('#ac-undo'); if (undo) undo.onclick = () => { TBJournal.undoEndDay(); render(); };
  }

  /* ============================ journal ============================ */

  function renderJournal() {
    const s = TBStore.load();
    const st = TBJournal.stats();
    const pre = journalPrefill || {};
    const instr = TBConfig.INSTRUMENTS;
    $('#screen').innerHTML =
      '<div class="stat-row">' +
        '<div class="stat-tile"><span class="stat-label">Trades</span><span class="stat-value">' + st.count + '</span></div>' +
        '<div class="stat-tile"><span class="stat-label">Win rate</span><span class="stat-value">' + (st.count ? Math.round(st.winRate * 100) + '%' : '—') + '</span></div>' +
        '<div class="stat-tile"><span class="stat-label">Avg win / loss</span><span class="stat-value stat-small">' + fmt$(st.avgWin) + ' / ' + fmt$(st.avgLoss) + '</span></div>' +
        '<div class="stat-tile"><span class="stat-label">Net P&L</span><span class="stat-value ' + (st.netPnl > 0 ? 'good' : st.netPnl < 0 ? 'bad' : '') + '">' + fmt$(st.netPnl) + '</span></div>' +
      '</div>' +
      '<div class="card form-card"><div class="card-head"><h2>Log a trade</h2>' + (journalPrefill ? '<span class="card-sub">prefilled from signal</span>' : '') + '</div>' +
        '<div class="form-grid">' +
        '<label>Instrument<select id="j-instr">' + Object.keys(instr).map(k =>
          '<option value="' + k + '"' + (k === (pre.instrument || s.settings.defaultInstrument) ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
        '<label>Direction<select id="j-dir"><option' + (pre.dir === 'LONG' ? ' selected' : '') + '>LONG</option><option' + (pre.dir === 'SHORT' ? ' selected' : '') + '>SHORT</option></select></label>' +
        '<label>Contracts<input id="j-qty" type="number" min="0" step="1" value="' + (pre.contracts || 1) + '"></label>' +
        '<label>Entry<input id="j-entry" type="number" step="any" value="' + (pre.entry != null ? pre.entry : '') + '"></label>' +
        '<label>Exit<input id="j-exit" type="number" step="any"></label>' +
        '<label>Net P&L ($)<input id="j-pnl" type="number" step="any" placeholder="after fees"></label>' +
        '</div>' +
        '<label>Notes<input id="j-notes" type="text" placeholder="setup, mistake, lesson…"></label>' +
        '<button class="btn btn-primary" id="j-add">Add trade</button>' +
        '<p class="fineprint">P&L updates your tracked balance. Enter the net figure from your platform.</p>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h2>Trades</h2></div>' +
        (s.trades.length
          ? s.trades.slice().reverse().map(t =>
            '<div class="trade-row"><div>' +
              '<span class="sig-mini ' + (t.dir === 'LONG' ? 'sig-long' : 'sig-short') + '">' + t.dir + '</span> ' +
              '<strong>' + esc(t.instrument) + '</strong> ×' + t.contracts +
              ' <span class="muted">' + t.date + (t.fromSignal ? ' · from signal' : '') + '</span>' +
              (t.notes ? '<div class="muted trade-notes">' + esc(t.notes) + '</div>' : '') +
            '</div><div class="trade-right"><span class="' + (t.pnl > 0 ? 'good' : t.pnl < 0 ? 'bad' : 'muted') + '">' + fmt$(t.pnl) + '</span>' +
              '<button class="btn btn-ghost btn-sm" data-del="' + t.id + '">✕</button></div></div>').join('')
          : '<p class="muted">No trades logged yet.</p>') +
      '</div>';

    $('#j-add').onclick = () => {
      const fromSignal = !!journalPrefill;
      TBJournal.logTrade({
        instrument: $('#j-instr').value, dir: $('#j-dir').value,
        contracts: $('#j-qty').value, entry: $('#j-entry').value, exit: $('#j-exit').value,
        pnl: $('#j-pnl').value, fromSignal, notes: $('#j-notes').value,
      });
      journalPrefill = null;
      render();
    };
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (confirm('Delete this trade? Its P&L will be removed from your balance.')) {
        TBJournal.deleteTrade(b.dataset.del); render();
      }
    });
  }

  /* ============================ settings =========================== */

  function renderSettings() {
    const s = TBStore.load();
    const p = TBJournal.plan();
    const ruleFields = [
      ['profitTarget', 'Profit target ($)'], ['maxLoss', 'Max loss ($)'],
      ['lockBuffer', 'MLL lock buffer ($)'], ['consistencyPct', 'Consistency rule (%)'],
      ['maxMinis', 'Max minis'], ['minTradingDays', 'Min trading days'],
    ];
    $('#screen').innerHTML =
      '<div class="card form-card"><div class="card-head"><h2>AI</h2></div>' +
        '<label>Claude API key<input id="st-key" type="password" value="' + esc(s.settings.apiKey) + '" placeholder="sk-ant-..." autocomplete="off"></label>' +
        '<label>Model<select id="st-model">' + TBConfig.MODELS.map(m =>
          '<option value="' + m.id + '"' + (m.id === s.settings.model ? ' selected' : '') + '>' + m.label + '</option>').join('') + '</select></label>' +
        '<p class="fineprint">Key is stored only in this browser\'s localStorage and sent only to api.anthropic.com. Each analysis costs roughly a cent.</p>' +
      '</div>' +
      '<div class="card form-card"><div class="card-head"><h2>Plan rules</h2><span class="card-sub">' + esc(p.label) + '</span></div>' +
        '<label>Plan preset<select id="st-plan">' + Object.values(TBConfig.PLANS).map(pl =>
          '<option value="' + pl.id + '"' + (pl.id === s.settings.planId ? ' selected' : '') + '>' + pl.label + '</option>').join('') + '</select></label>' +
        '<p class="sig-sub">' + esc(p.notes) + '</p>' +
        '<div class="form-grid">' + ruleFields.map(f =>
          '<label>' + f[1] + '<input type="number" step="any" data-rule="' + f[0] + '" value="' + p[f[0]] + '"></label>').join('') +
        '</div>' +
        '<p class="fineprint">⚠ Presets reflect MFFU\'s published rules as of mid-2026 and can drift — always verify against your MFFU dashboard, and edit these numbers to match. Changing the preset resets your edits.</p>' +
      '</div>' +
      '<div class="card form-card"><div class="card-head"><h2>Risk</h2></div>' +
        '<label>Risk per trade (% of remaining buffer)<input id="st-risk" type="number" min="1" max="100" value="' + s.settings.riskPct + '"></label>' +
        '<p class="fineprint">At 25% you survive at least 4 straight max-size losses. Raising this is how evaluations die.</p>' +
      '</div>' +
      '<div class="card form-card"><div class="card-head"><h2>Danger zone</h2></div>' +
        '<button class="btn" id="st-reset-acct">Reset account tracking (keep settings)</button>' +
        '<button class="btn" id="st-reset-all">Reset everything</button>' +
      '</div>' +
      '<button class="btn btn-primary btn-lg" id="st-save">Save settings</button>';

    $('#st-plan').onchange = () => {
      const sNow = TBStore.load();
      sNow.settings.planId = $('#st-plan').value;
      sNow.settings.planOverrides = {};
      TBStore.save(); renderSettings();
    };
    $('#st-save').onclick = () => {
      const sNow = TBStore.load();
      sNow.settings.apiKey = $('#st-key').value.trim();
      sNow.settings.model = $('#st-model').value;
      sNow.settings.riskPct = Math.max(1, Math.min(100, parseFloat($('#st-risk').value) || 25));
      const base = TBConfig.PLANS[sNow.settings.planId];
      const overrides = {};
      document.querySelectorAll('[data-rule]').forEach(inp => {
        const v = parseFloat(inp.value);
        if (!isNaN(v) && v !== base[inp.dataset.rule]) overrides[inp.dataset.rule] = v;
      });
      sNow.settings.planOverrides = overrides;
      TBStore.save();
      tab = 'account'; render();
    };
    $('#st-reset-acct').onclick = () => {
      if (!confirm('Clear balance history, trades, and signals? Settings are kept.')) return;
      const sNow = TBStore.load();
      sNow.account = { balance: TBJournal.plan().startBalance, days: [] };
      sNow.trades = []; sNow.signals = [];
      TBStore.save(); render();
    };
    $('#st-reset-all').onclick = () => {
      if (confirm('Reset the entire app, including your API key?')) { TBStore.reset(); render(); }
    };
  }

  /* ============================= boot ============================= */

  document.addEventListener('paste', e => {
    if (TBStore.load().settings.onboarded === false) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        tab = 'analyze';
        setChart(it.getAsFile());
        return;
      }
    }
  });

  render();
})();
