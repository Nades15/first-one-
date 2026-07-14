/* Fairline dashboard — polls /api/state and renders. Pulse's visual language. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var usd = function (v) { return (v >= 0 ? '+' : '−') + '$' + Math.abs(Number(v)).toFixed(2); };
  var cls = function (v) { return v > 0 ? 'good' : v < 0 ? 'bad' : ''; };
  var cents = function (p) { return p == null ? '—' : Math.round(p * 100) + '¢'; };
  var pctP = function (p) { return p == null ? '—' : (p * 100).toFixed(1) + '%'; };
  var countdown = function (sec) {
    if (sec == null) return '—';
    if (sec >= 3600) return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    if (sec >= 60) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    return sec + 's';
  };

  function statusChip(st) {
    var kind = st === 'open' || st === 'HOLDING' ? ' chip-good'
      : st === 'in-flight' || st === 'EDGE' ? ' chip-warn'
      : st === 'DAILY_STOP' || st === 'PANIC' || st === 'MAX_CONCURRENT' ? ' chip-bad' : '';
    return '<span class="chip' + kind + '">' + esc(String(st).replace(/_/g, ' ').toLowerCase()) + '</span>';
  }

  function spotTile(asset, s) {
    var vol = s.sigmaHourPct != null ? 'σ ' + s.sigmaHourPct.toFixed(2) + '%/√h' : 'warming ' + s.samples;
    return '<div class="spot-tile"><div class="s-asset">' + esc(asset) + '</div>' +
      '<div class="s-price">' + (s.price ? '$' + Number(s.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—') + '</div>' +
      '<div class="s-vol">' + esc(vol) + '</div></div>';
  }

  function marketRow(m) {
    var edge = null;
    if (m.edgeYes != null && m.edgeNo != null) edge = Math.max(m.edgeYes, m.edgeNo);
    var edgeStr = edge == null ? '—' : ((edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + '¢');
    return '<div class="mkt-row">' +
      '<div class="mkt-top"><span class="mkt-title"><a href="' + esc(m.url) + '" target="_blank" rel="noopener">' +
        esc(m.title) + '</a></span>' + statusChip(m.status) + '</div>' +
      '<div class="mkt-nums">' +
        '<span>' + esc(m.platform) + ' · ' + esc(m.asset) + '</span>' +
        '<span>fair ' + pctP(m.fair) + ' · bid ' + cents(m.yesBid) + ' / ask ' + cents(m.yesAsk) + '</span>' +
        '<span class="' + (edge != null && edge > 0 ? 'edge-pos' : '') + '">edge ' + edgeStr + '</span>' +
        '<span>closes ' + countdown(m.tauSec) + '</span>' +
      '</div>' +
    '</div>';
  }

  function positionCard(p, now) {
    var toClose = Math.max(0, Math.round((p.closeTime - now) / 1000));
    return '<div class="card pos-card">' +
      '<div class="card-head"><h2>' + esc(p.title) + '</h2>' +
        '<span class="chip mono">' + esc(p.side.toUpperCase()) + ' ×' + p.contracts + '</span></div>' +
      '<div class="kv"><span class="k">entry</span><span class="mono">' + cents(p.avgPrice) +
        ' · model said ' + pctP(p.entryFair) + ' (edge +' + (p.entryEdge * 100).toFixed(1) + '¢)</span></div>' +
      '<div class="kv"><span class="k">cost</span><span class="mono">$' + p.costUsd.toFixed(2) +
        (p.feeUsd ? ' + $' + p.feeUsd.toFixed(2) + ' fee' : '') + '</span></div>' +
      '<div class="kv"><span class="k">mark</span><span class="mono ' + cls(p.markUsd) + '">' + usd(p.markUsd || 0) + '</span></div>' +
      '<div class="kv"><span class="k">resolves</span><span class="mono">' + countdown(toClose) + '</span></div>' +
    '</div>';
  }

  function tradeRow(t) {
    var outcome = t.won === true ? 'WON' : t.won === false ? 'LOST' : esc(t.exitReason);
    var kind = t.won === true ? ' extend' : t.won === false ? ' emergency' : ' weak';
    return '<div class="trade-row">' +
      '<div class="trade-top"><span class="trade-title">' + esc(t.title) + '</span>' +
        '<span class="reason-chip' + kind + '">' + outcome + '</span></div>' +
      '<div class="trade-sub"><span class="mono ' + cls(t.pnlNetUsd) + '">' + usd(t.pnlNetUsd) + '</span>' +
        '<span class="mono">' + esc(t.side) + ' ×' + t.contracts + ' @' + cents(t.avgPrice) +
        ' · model ' + pctP(t.entryFair) + (t.feeUsd ? ' · fees $' + t.feeUsd.toFixed(2) : '') + '</span></div>' +
    '</div>';
  }

  function calibrationCard(cal) {
    if (!cal || !cal.length) {
      return '<div class="card"><div class="card-head"><h2>Calibration</h2></div>' +
        '<p class="muted">Settled trades will plot here: model probability vs how often that side actually won.</p></div>';
    }
    var W = 160, pad = 14;
    var xy = function (v) { return pad + v * (W - 2 * pad); };
    var dots = cal.map(function (b) {
      var r = Math.min(9, 2.5 + Math.sqrt(b.n));
      return '<circle class="cal-dot" cx="' + xy(b.predicted).toFixed(1) + '" cy="' + (W - xy(b.actual)).toFixed(1) +
        '" r="' + r.toFixed(1) + '"><title>' + (b.predicted * 100).toFixed(0) + '% predicted → ' +
        (b.actual * 100).toFixed(0) + '% actual (n=' + b.n + ')</title></circle>';
    }).join('');
    var n = cal.reduce(function (a, b) { return a + b.n; }, 0);
    return '<div class="card">' +
      '<div class="card-head"><h2>Calibration</h2><span class="card-sub">' + n + ' settled</span></div>' +
      '<div class="cal-wrap">' +
        '<svg class="cal-svg" viewBox="0 0 ' + W + ' ' + W + '">' +
          '<line class="cal-diag" x1="' + xy(0) + '" y1="' + (W - xy(0)) + '" x2="' + xy(1) + '" y2="' + (W - xy(1)) + '"/>' +
          '<text class="cal-axis" x="' + xy(0) + '" y="' + (W - 3) + '">model %</text>' +
          '<text class="cal-axis" x="3" y="' + xy(0) + '" transform="rotate(-90 8 ' + xy(0) + ')">actual %</text>' +
          dots +
        '</svg>' +
        '<p class="cal-legend">Dots on the dashed line = the model is honest about its own odds. ' +
          'Dots below it = overconfidence, and any “edge” built on it is fiction. This chart is the experiment.</p>' +
      '</div>' +
    '</div>';
  }

  function render(s) {
    var g = s.gate || {};
    var gatePct = Math.min(100, (g.paperTrades / (g.required || 100)) * 100);
    var led = s.ledger || {};
    var pos = s.positions || [];
    var mkts = s.markets || [];
    var trades = s.recentTrades || [];
    var spotKeys = Object.keys(s.spot || {});
    var now = Date.now();

    app.innerHTML =
      '<header class="topbar">' +
        '<div class="brand">📐 Fairline</div>' +
        '<div class="topbar-stats">' +
          '<span class="chip mode-' + esc(s.mode) + '">' + esc(s.mode) + '</span>' +
          '<span class="chip mono"><span class="feed-dot ' + (s.feed.connected ? 'on' : 'off') + '"></span>' +
            esc(s.feed.venue || s.feed.kind || 'feed') + '</span>' +
        '</div>' +
      '</header>' +
      '<main class="screen">' +

        // spot + ledger
        '<div class="card">' +
          '<div class="card-head"><h2>Spot</h2><span class="card-sub">fair line inputs</span></div>' +
          '<div class="spot-grid">' + spotKeys.map(function (a) { return spotTile(a, s.spot[a]); }).join('') + '</div>' +
          '<div class="kv"><span class="k">today net</span><span class="mono ' + cls(led.realizedNetUsd) + '">' +
            usd(led.realizedNetUsd || 0) + ' / stop −$' + (led.dailyStopUsd || 0) + '</span></div>' +
        '</div>' +

        // gate
        '<div class="card">' +
          '<div class="card-head"><h2>Stats gate</h2><span class="chip ' + (g.unlocked ? 'chip-good' : 'chip-warn') + '">' +
            (g.unlocked ? '🔓 open' : '🔒 measuring') + '</span></div>' +
          '<div class="gate-track"><div class="gate-fill ' + (g.unlocked ? '' : 'locked') + '" style="width:' + gatePct + '%"></div></div>' +
          '<div class="kv"><span class="k">settled paper trades</span><span class="mono">' + g.paperTrades + ' / ' + g.required + '</span></div>' +
          '<div class="kv"><span class="k">paper net PnL</span><span class="mono ' + cls(g.paperNetUsd) + '">' + usd(g.paperNetUsd || 0) + '</span></div>' +
          '<p class="fineprint">Fairline is paper-only. A green gate means the plumbing works and the edge survived fees over one sample — not a promise it persists.</p>' +
        '</div>' +

        // open positions
        (pos.length ? pos.map(function (p) { return positionCard(p, now); }).join('') :
          '<div class="card"><p class="muted">No open positions. Watching ' + mkts.length + ' market(s)…</p></div>') +

        // watched markets
        '<div class="card">' +
          '<div class="card-head"><h2>Watched markets</h2><span class="card-sub">' + mkts.length + '</span></div>' +
          (mkts.length ? mkts.map(marketRow).join('') :
            '<p class="muted">Nothing in the window yet — discovery sweeps every minute.</p>') +
        '</div>' +

        calibrationCard(s.calibration) +

        '<button class="panic" id="panic">🛑 PANIC — close everything &amp; halt</button>' +

        // trade log
        '<div class="card">' +
          '<div class="card-head"><h2>Recent trades</h2><span class="card-sub">' + trades.length + '</span></div>' +
          (trades.length ? trades.map(tradeRow).join('') : '<p class="muted">No trades yet.</p>') +
        '</div>' +
      '</main>';

    var panic = document.getElementById('panic');
    if (panic) panic.onclick = function () {
      if (confirm('Close all paper positions at the book and halt trading?')) {
        fetch('/api/panic', { method: 'POST' });
      }
    };
  }

  function poll() {
    fetch('/api/state').then(function (r) { return r.json(); }).then(render).catch(function () {});
  }
  poll();
  setInterval(poll, 1000);
})();
