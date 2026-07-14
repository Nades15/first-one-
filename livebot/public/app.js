/* Livebot dashboard — polls /api/state and renders. Pulse's visual language. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var sol = function (v) { return (v >= 0 ? '+' : '') + Number(v).toFixed(4); };
  var pct = function (v) { return (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%'; };
  var cls = function (v) { return v > 0 ? 'good' : v < 0 ? 'bad' : ''; };
  var short = function (s) { return s ? s.slice(0, 4) + '…' + s.slice(-4) : '—'; };

  function reasonChip(r, ext) {
    var label = String(r).replace('EMERGENCY_', '').replace(/_/g, ' ');
    var kind = String(r).indexOf('EMERGENCY_') === 0 ? ' emergency'
      : r === 'WEAK_MOMENTUM' ? ' weak' : ext ? ' extend' : '';
    return '<span class="reason-chip' + kind + '">' + esc(label) + '</span>';
  }

  function gauge(label, val, state) {
    return '<div class="gauge ' + state + '"><span class="g-val">' + val + '</span>' +
      '<span class="g-label">' + label + '</span></div>';
  }

  function positionCard(p) {
    var g = p.gauges || {};
    var vel = g.velPctPerSec || 0, ratio = (g.buyVolRatio || 0) * 100, acc = g.volAccel || 0, imp = g.impactPct || 0;
    return '<div class="card pos-card">' +
      '<div class="card-head"><h2>' + esc(p.symbol || p.mint) + '</h2>' +
        '<span class="chip mono">' + (p.heldMs / 1000).toFixed(1) + 's · ' + esc(p.state) + '</span></div>' +
      '<div class="gauges">' +
        gauge('vel %/s', (vel >= 0 ? '+' : '') + vel.toFixed(1), vel >= 2 ? 'ok' : vel <= -1.5 ? 'bad' : '') +
        gauge('buy %', ratio.toFixed(0), g.buyVolRatio >= 0.62 ? 'ok' : g.buyVolRatio <= 0.42 ? 'bad' : '') +
        gauge('vol ×', acc.toFixed(2), acc >= 1.2 ? 'ok' : acc <= 0.4 ? 'bad' : '') +
        gauge('impact %', imp.toFixed(1), imp > 8 ? 'bad' : imp > 4 ? 'warn' : 'ok') +
      '</div>' +
      '<div class="banner ' + (g.momentum === 'strong' ? 'extend' : 'hold') + '">momentum ' + esc(g.momentum || '—') +
        (g.extensionsUsed ? ' · +' + g.extensionsUsed + ' ext' : '') + '</div>' +
    '</div>';
  }

  function tradeRow(t) {
    var f = t.exit.fees || {};
    var feeStr = 'fees: plat ' + (f.platform || 0).toFixed(5) + ' · portal ' + (f.portal || 0).toFixed(5) +
      ' · prio ' + (f.priority || 0).toFixed(5);
    return '<div class="trade-row">' +
      '<div class="trade-top"><span class="trade-title">' + esc(t.symbol || t.mint) + '</span>' +
        reasonChip(t.exit.reason, t.extensions) + '</div>' +
      '<div class="trade-sub"><span class="mono ' + cls(t.pnlNetSol) + '">' + sol(t.pnlNetSol) + ' SOL (' + pct(t.pnlPct) + ')</span>' +
        '<span class="chip">' + esc(t.mode) + (t.exit.failed ? ' · stuck' : '') + '</span></div>' +
      '<div class="fee-detail mono">' + esc(feeStr) + '</div>' +
    '</div>';
  }

  function render(s) {
    var g = s.gate || {};
    var gatePctRaw = Math.min(100, (g.paperTrades / (g.required || 50)) * 100);
    var led = s.ledger || {};
    var pos = s.positions || [];
    var trades = s.recentTrades || [];

    app.innerHTML =
      '<header class="topbar">' +
        '<div class="brand">🤖 Livebot</div>' +
        '<div class="topbar-stats">' +
          '<span class="chip mode-' + esc(s.mode) + '">' + esc(s.mode) + '</span>' +
          '<span class="chip mono">' + esc(short(s.wallet && s.wallet.pubkey)) + '</span>' +
        '</div>' +
      '</header>' +
      '<main class="screen">' +

        // feed + ledger status
        '<div class="card">' +
          '<div class="kv"><span class="k"><span class="feed-dot ' + (s.feed.connected ? 'on' : 'off') + '"></span>feed</span>' +
            '<span class="mono">' + (s.feed.connected ? 'live' : 'down') + ' · ' + s.feed.watched + ' watched · ' +
            s.feed.launches + ' launches · ' + s.feed.trades + ' trades</span></div>' +
          '<div class="kv"><span class="k">today net</span><span class="mono ' + cls(led.realizedNetSol) + '">' +
            sol(led.realizedNetSol || 0) + ' SOL / stop ' + (-(led.dailyStopSol || 0)) + '</span></div>' +
          (s.wallet && s.wallet.balanceSol != null ?
            '<div class="kv"><span class="k">wallet</span><span class="mono">' + Number(s.wallet.balanceSol).toFixed(4) + ' SOL</span></div>' : '') +
        '</div>' +

        // go-live gate
        '<div class="card">' +
          '<div class="card-head"><h2>Go-live gate</h2><span class="chip ' + (g.unlocked ? 'chip-good' : 'chip-warn') + '">' +
            (g.unlocked ? '🔓 unlocked' : '🔒 locked') + '</span></div>' +
          '<div class="gate-track"><div class="gate-fill ' + (g.unlocked ? '' : 'locked') + '" style="width:' + gatePctRaw + '%"></div></div>' +
          '<div class="kv"><span class="k">paper trades</span><span class="mono">' + g.paperTrades + ' / ' + g.required + '</span></div>' +
          '<div class="kv"><span class="k">paper net PnL</span><span class="mono ' + cls(g.paperNetSol) + '">' + sol(g.paperNetSol || 0) + ' SOL</span></div>' +
          '<p class="fineprint">Live trading unlocks only at ≥' + g.required + ' paper trades AND net-positive PnL after fees.</p>' +
        '</div>' +

        // open positions
        (pos.length ? pos.map(positionCard).join('') :
          '<div class="card"><p class="muted">No open positions. Watching for launches…</p></div>') +

        // panic
        '<button class="panic" id="panic">🛑 PANIC — sell everything &amp; halt</button>' +

        // trade log
        '<div class="card">' +
          '<div class="card-head"><h2>Recent trades</h2><span class="card-sub">' + trades.length + '</span></div>' +
          (trades.length ? trades.map(tradeRow).join('') : '<p class="muted">No trades yet.</p>') +
        '</div>' +
      '</main>';

    var panic = document.getElementById('panic');
    if (panic) panic.onclick = function () {
      if (confirm('Sell all open positions and halt trading?')) {
        fetch('/api/panic', { method: 'POST' });
      }
    };
  }

  function poll() {
    fetch('/api/state').then(function (r) { return r.json(); }).then(render).catch(function () {});
  }
  poll();
  setInterval(poll, 500);
})();
