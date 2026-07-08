/* MFFU Trade Copilot — account bookkeeping & trade journal.
 * Bridges stored state (TBStore) and the pure rules engine (TBRules).
 */
window.TBJournal = (function () {
  'use strict';

  function plan() {
    const s = TBStore.load();
    return TBConfig.planWithOverrides(s.settings.planId, s.settings.planOverrides);
  }

  /* Balance at the start of today = last completed day's close (or plan start). */
  function startOfDayBalance() {
    const s = TBStore.load();
    const days = s.account.days;
    return days.length ? days[days.length - 1].endBalance : plan().startBalance;
  }

  function todayPnl() {
    return TBStore.load().account.balance - startOfDayBalance();
  }

  /* Daily net P&Ls including today's running figure (for consistency math). */
  function dayPnls() {
    const s = TBStore.load();
    const list = s.account.days.map(d => d.pnl);
    const t = todayPnl();
    if (t !== 0 || tradesToday().length) list.push(t);
    return list;
  }

  function tradesToday() {
    const today = TBStore.todayISO();
    return TBStore.load().trades.filter(t => t.date === today);
  }

  function tradingDaysCount() {
    const s = TBStore.load();
    let n = s.account.days.filter(d => d.traded).length;
    const today = TBStore.todayISO();
    if (!s.account.days.some(d => d.date === today) && tradesToday().length) n += 1;
    return n;
  }

  /* Full derived snapshot for the dashboard & pre-trade checks. */
  function snapshot() {
    const s = TBStore.load();
    const p = plan();
    const { floor, locked } = TBRules.replayFloor(p, s.account.days);
    return {
      plan: p,
      balance: s.account.balance,
      floor,
      floorLocked: locked,
      dist: TBRules.distanceToBreach(s.account.balance, floor),
      target: TBRules.targetProgress(p, s.account.balance),
      cons: TBRules.consistency(dayPnls(), p.consistencyPct),
      todayPnl: todayPnl(),
      tradingDays: tradingDaysCount(),
      breached: s.account.balance <= floor,
    };
  }

  /* One-line account context for the AI prompt. */
  function accountContextText() {
    const snap = snapshot();
    let txt = 'MyFundedFutures ' + snap.plan.label + ' evaluation. Balance $' + snap.balance.toFixed(0) +
      ', Max Loss Limit $' + snap.floor.toFixed(0) + ' ($' + Math.max(0, snap.dist).toFixed(0) + ' buffer remaining), ' +
      '$' + snap.target.remaining.toFixed(0) + ' left to the $' + snap.plan.profitTarget + ' profit target. ' +
      'P&L today: $' + snap.todayPnl.toFixed(0) + '.';
    if (snap.cons.applies) {
      txt += ' A ' + snap.plan.consistencyPct + '% consistency rule applies (best day / total profit).';
    }
    if (snap.dist < snap.plan.maxLoss * 0.4) {
      txt += ' The buffer is thin — only take A+ setups.';
    }
    return txt;
  }

  function logTrade({ instrument, dir, contracts, entry, exit, pnl, fromSignal, signalId, sigConfidence, sigTimeframe, notes }) {
    const s = TBStore.load();
    s.trades.push({
      id: TBStore.uid(), date: TBStore.todayISO(),
      instrument, dir, contracts: Number(contracts) || 0,
      entry: Number(entry) || null, exit: Number(exit) || null,
      pnl: Number(pnl) || 0, fromSignal: !!fromSignal, notes: notes || '',
      // snapshot signal metadata on the trade so accuracy stats survive the
      // signals list being capped at 20 entries
      signalId: signalId || null,
      sigConfidence: sigConfidence != null ? Number(sigConfidence) : null,
      sigTimeframe: sigTimeframe || null,
    });
    s.account.balance = Math.round((s.account.balance + (Number(pnl) || 0)) * 100) / 100;
    TBStore.save();
  }

  function deleteTrade(id) {
    const s = TBStore.load();
    const i = s.trades.findIndex(t => t.id === id);
    if (i === -1) return;
    s.account.balance = Math.round((s.account.balance - (s.trades[i].pnl || 0)) * 100) / 100;
    s.trades.splice(i, 1);
    TBStore.save();
  }

  /* Manual sync when the app drifts from the real MFFU dashboard. */
  function setBalance(balance) {
    const s = TBStore.load();
    s.account.balance = Number(balance);
    TBStore.save();
  }

  /* Close the trading day: record it and let the EOD floor trail. */
  function endDay() {
    const s = TBStore.load();
    const today = TBStore.todayISO();
    if (s.account.days.some(d => d.date === today)) return false; // already closed
    s.account.days.push({
      date: today,
      endBalance: s.account.balance,
      pnl: todayPnl(),
      traded: tradesToday().length > 0 || todayPnl() !== 0,
    });
    TBStore.save();
    return true;
  }

  function undoEndDay() {
    const s = TBStore.load();
    const today = TBStore.todayISO();
    const i = s.account.days.findIndex(d => d.date === today);
    if (i === -1) return false;
    s.account.days.splice(i, 1);
    TBStore.save();
    return true;
  }

  function stats() {
    const s = TBStore.load();
    const withPnl = s.trades.filter(t => t.pnl !== 0);
    const wins = withPnl.filter(t => t.pnl > 0);
    const losses = withPnl.filter(t => t.pnl < 0);
    const sum = a => a.reduce((x, t) => x + t.pnl, 0);
    return {
      count: s.trades.length,
      winRate: withPnl.length ? wins.length / withPnl.length : 0,
      avgWin: wins.length ? sum(wins) / wins.length : 0,
      avgLoss: losses.length ? sum(losses) / losses.length : 0,
      netPnl: sum(withPnl),
    };
  }

  /*
   * How the AI's signals are actually performing, from signal-linked trades
   * with a recorded P&L. Buckets by the signal's confidence and timeframe.
   */
  function aiStats() {
    const s = TBStore.load();
    const linked = s.trades.filter(t => t.fromSignal && t.pnl !== 0);
    const rate = a => a.length ? a.filter(t => t.pnl > 0).length / a.length : null;
    const byBucket = (label, filter) => {
      const g = linked.filter(filter);
      return { label, n: g.length, winRate: rate(g) };
    };
    const tfGroups = {};
    for (const t of linked) {
      const tf = t.sigTimeframe || 'unknown';
      (tfGroups[tf] = tfGroups[tf] || []).push(t);
    }
    return {
      n: linked.length,
      winRate: rate(linked),
      netPnl: linked.reduce((a, t) => a + t.pnl, 0),
      byConfidence: [
        byBucket('80%+', t => t.sigConfidence >= 80),
        byBucket('70–79%', t => t.sigConfidence >= 70 && t.sigConfidence < 80),
        byBucket('<70%', t => t.sigConfidence != null && t.sigConfidence < 70),
      ],
      byTimeframe: Object.keys(tfGroups).map(tf => ({ label: tf, n: tfGroups[tf].length, winRate: rate(tfGroups[tf]) })),
    };
  }

  /* Outcome of the trade linked to a signal: 'win' | 'loss' | null. */
  function signalOutcome(signalId) {
    const t = TBStore.load().trades.find(tr => tr.signalId === signalId && tr.pnl !== 0);
    return t ? (t.pnl > 0 ? 'win' : 'loss') : null;
  }

  function saveSignal(sig, instrumentSymbol, model) {
    const s = TBStore.load();
    const rec = { id: TBStore.uid(), date: new Date().toISOString(), instrument: instrumentSymbol, model, sig };
    s.signals.unshift(rec);
    if (s.signals.length > 20) s.signals.length = 20;
    TBStore.save();
    return rec;
  }

  return {
    plan, snapshot, accountContextText, dayPnls, startOfDayBalance, todayPnl,
    logTrade, deleteTrade, setBalance, endDay, undoEndDay, stats, aiStats, signalOutcome, saveSignal, tradesToday,
  };
})();
