/* Lumen — screens, navigation, dashboard, onboarding, EQ moment, journal, weekly recap. */
(function () {
  'use strict';

  const h = window.Games.h;
  const root = () => document.getElementById('app');
  const S = () => window.Store.load();
  /* replaceChildren stringifies null args, so filter them out. */
  const setChildren = (el, ...nodes) => el.replaceChildren(...nodes.flat().filter((n) => n != null));

  /* =============== boot =============== */

  function boot() {
    const state = S();
    window.Scoring.rolloverIfNeeded(state);
    if (!state.profile) renderWelcome();
    else renderDashboard();
  }

  /* =============== onboarding =============== */

  function renderWelcome() {
    root().replaceChildren(
      h('div', { class: 'screen welcome' },
        h('div', { class: 'logo-big' }, '🧠'),
        h('h1', {}, 'Lumen'),
        h('p', { class: 'tagline' }, 'Ten focused minutes a day. A measurably sharper you by Sunday.'),
        h('div', { class: 'card' },
          h('h2', {}, 'How it works'),
          h('ul', { class: 'howto' },
            h('li', {}, h('strong', {}, '1. Set your baseline'), ' — take a short assessment, or enter a score you already know.'),
            h('li', {}, h('strong', {}, '2. Check in daily'), ' — three quick brain games, one emotional-intelligence moment, one journal prompt. 10–15 minutes, no more.'),
            h('li', {}, h('strong', {}, '3. Recalibrate weekly'), ' — every week your IQ and EQ indexes shift based on how you actually performed. Consistency counts as much as brilliance.')),
        ),
        h('div', { class: 'welcome-actions' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: renderBaselineIntro }, 'Take the baseline test'),
          h('button', { class: 'btn btn-ghost', onclick: renderManualEntry }, 'I already know my score')),
        h('p', { class: 'fineprint' }, 'Lumen\'s scores are training indexes for tracking your own progress — not a clinical IQ measurement.'),
      ),
    );
  }

  function renderBaselineIntro() {
    root().replaceChildren(
      h('div', { class: 'screen' },
        h('h1', {}, 'Baseline assessment'),
        h('p', { class: 'tagline' }, '20 reasoning questions plus 5 emotional-awareness situations. About 8–10 minutes. Work briskly but don\'t rush — there\'s no timer.'),
        h('div', { class: 'welcome-actions' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => runBaselineTest() }, 'Begin'),
          h('button', { class: 'btn btn-ghost', onclick: renderWelcome }, 'Back')),
      ),
    );
  }

  function runBaselineTest() {
    const iqItems = window.DATA.baselineIQ;
    const eqItems = window.DATA.baselineEQ.map((it) => ({
      q: it.q,
      options: window.Games.shuffle(it.options, Math.random),
    }));
    const iqAnswers = [];
    let eqPoints = 0;
    let i = 0;
    const total = iqItems.length + eqItems.length;

    function show() {
      if (i >= total) return finish();
      const isIQ = i < iqItems.length;
      const item = isIQ ? iqItems[i] : eqItems[i - iqItems.length];
      const options = isIQ ? item.options : item.options.map((o) => o.text);
      const pct = Math.round((i / total) * 100);
      root().replaceChildren(
        h('div', { class: 'screen' },
          h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${pct}%` })),
          h('p', { class: 'test-count' }, `Question ${i + 1} of ${total}` + (isIQ ? '' : ' · emotional awareness')),
          h('p', { class: 'game-q' }, item.q),
          h('div', { class: 'options' },
            options.map((opt, oi) =>
              h('button', { class: 'option-btn', onclick: () => answer(oi) }, opt))),
        ),
      );
    }

    function answer(oi) {
      if (i < iqItems.length) iqAnswers.push(oi);
      else eqPoints += eqItems[i - iqItems.length].options[oi].pts;
      i++;
      show();
    }

    function finish() {
      const iq = window.Scoring.gradeBaselineIQ(iqAnswers);
      const eq = window.Scoring.gradeBaselineEQ(eqPoints);
      completeOnboarding(iq, eq, 'test');
    }

    show();
  }

  function renderManualEntry() {
    const iqInput = h('input', { class: 'num-input', type: 'number', min: 55, max: 160, value: 100 });
    const eqInput = h('input', { class: 'num-input', type: 'number', min: 55, max: 160, value: 100 });
    root().replaceChildren(
      h('div', { class: 'screen' },
        h('h1', {}, 'Import your score'),
        h('p', { class: 'tagline' }, 'Enter a score from a test you\'ve taken. If you\'re unsure about EQ, leave it at 100 — the week\'s activities will calibrate it.'),
        h('div', { class: 'card manual-card' },
          h('label', {}, 'IQ score', iqInput),
          h('label', {}, 'EQ index (optional)', eqInput)),
        h('div', { class: 'welcome-actions' },
          h('button', {
            class: 'btn btn-primary btn-lg', onclick: () => {
              const iq = window.Scoring.clamp(Math.round(Number(iqInput.value) || 100), 55, 160);
              const eq = window.Scoring.clamp(Math.round(Number(eqInput.value) || 100), 55, 160);
              completeOnboarding(iq, eq, 'manual');
            },
          }, 'Start my week'),
          h('button', { class: 'btn btn-ghost', onclick: renderWelcome }, 'Back')),
      ),
    );
  }

  function completeOnboarding(iq, eq, source) {
    const state = S();
    state.profile = { baselineIQ: iq, baselineEQ: eq, source, createdAt: window.Store.todayISO() };
    state.iq = iq;
    state.eq = eq;
    state.weekStart = window.Store.mondayOf(window.Store.todayISO());
    state.scoreHistory = [{ date: window.Store.todayISO(), iq, eq }];
    window.Store.save();

    root().replaceChildren(
      h('div', { class: 'screen welcome' },
        h('div', { class: 'logo-big' }, source === 'test' ? '✨' : '📌'),
        h('h1', {}, 'Baseline set'),
        h('div', { class: 'baseline-result' },
          h('div', { class: 'stat-tile' }, h('span', { class: 'stat-label' }, 'IQ index'), h('span', { class: 'stat-value' }, String(iq))),
          h('div', { class: 'stat-tile' }, h('span', { class: 'stat-label' }, 'EQ index'), h('span', { class: 'stat-value' }, String(eq)))),
        h('p', { class: 'tagline' }, 'This is your starting point, not your ceiling. Show up this week and watch it move.'),
        h('button', { class: 'btn btn-primary btn-lg', onclick: renderDashboard }, 'Start today\'s circuit'),
      ),
    );
  }

  /* =============== dashboard =============== */

  function circuitStatus() {
    const today = window.Store.today();
    const circuit = window.Games.circuitFor(window.Store.todayISO());
    const items = circuit.map((id) => ({
      kind: 'game', id,
      game: window.Games.registry[id],
      done: today.games[id] != null,
      score: today.games[id] ? today.games[id].score : null,
    }));
    items.push({ kind: 'eq', id: 'eq', done: today.eqScore != null, score: today.eqScore });
    items.push({ kind: 'journal', id: 'journal', done: !!today.journal, score: today.journal ? Math.round((today.journal.iqComponent + today.journal.eqComponent) / 2) : null });
    return items;
  }

  function renderDashboard() {
    const state = S();
    window.Scoring.rolloverIfNeeded(state);
    const items = circuitStatus();
    const doneCount = items.filter((x) => x.done).length;
    const allDone = doneCount === items.length;
    const daysDone = Object.values(state.days).filter((d) => d.done).length;
    const iqDelta = state.iq - state.profile.baselineIQ;
    const eqDelta = state.eq - state.profile.baselineEQ;

    const deltaSpan = (d) => d === 0 ? null :
      h('span', { class: d > 0 ? 'delta delta-up' : 'delta delta-down' }, (d > 0 ? '↑' : '↓') + Math.abs(d) + ' since baseline');

    root().replaceChildren(
      h('div', { class: 'screen dash' },
        h('header', { class: 'dash-header' },
          h('div', {}, h('h1', {}, '🧠 Lumen'), h('p', { class: 'dash-date' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))),
        ),

        state.pendingRecap ? recapBanner(state.pendingRecap) : null,

        h('div', { class: 'stat-row' },
          h('div', { class: 'stat-tile' },
            h('span', { class: 'stat-label' }, 'IQ index'),
            h('span', { class: 'stat-value' }, String(state.iq)),
            deltaSpan(iqDelta)),
          h('div', { class: 'stat-tile' },
            h('span', { class: 'stat-label' }, 'EQ index'),
            h('span', { class: 'stat-value' }, String(state.eq)),
            deltaSpan(eqDelta)),
          h('div', { class: 'stat-tile' },
            h('span', { class: 'stat-label' }, 'Streak'),
            h('span', { class: 'stat-value' }, (state.streak || 0) + ' 🔥'),
            h('span', { class: 'stat-sub' }, state.streak ? 'day' + (state.streak > 1 ? 's' : '') + ' in a row' : 'complete today to start')),
          h('div', { class: 'stat-tile' },
            h('span', { class: 'stat-label' }, 'This week'),
            h('span', { class: 'stat-value' }, daysDone + '/7'),
            h('span', { class: 'stat-sub' }, 'days complete')),
        ),

        h('div', { class: 'card' },
          h('div', { class: 'card-head' },
            h('h2', {}, allDone ? 'Circuit complete! 🎉' : 'Today\'s circuit'),
            h('span', { class: 'card-sub' }, allDone ? 'See you tomorrow — same time, sharper you.' : `${doneCount}/${items.length} done · ~${(items.length - doneCount) * 3} min left`)),
          h('div', { class: 'circuit-list' }, items.map(circuitRow)),
        ),

        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, 'Your trend'),
            h('span', { class: 'card-sub' }, 'One point per weekly recalibration')),
          trendChart(state.scoreHistory)),

        state.history.length ? pastWeeksCard(state.history) : null,

        h('footer', { class: 'dash-footer' },
          h('button', {
            class: 'btn btn-ghost btn-sm', onclick: () => {
              if (confirm('Erase all progress and start over from a new baseline?')) { window.Store.reset(); boot(); }
            },
          }, 'Start over')),
      ),
    );

    if (allDone && !renderDashboard._celebrated && state.lastCompleteDay === window.Store.todayISO()) {
      renderDashboard._celebrated = true;
      confetti();
    }
  }

  function circuitRow(item) {
    const meta = item.kind === 'game'
      ? { icon: item.game.icon, name: item.game.name, blurb: item.game.blurb, go: () => renderGame(item.id) }
      : item.kind === 'eq'
        ? { icon: '💛', name: 'EQ Moment', blurb: 'A real-life situation and an emotion to read.', go: renderEQ }
        : { icon: '📓', name: 'Journal', blurb: 'One prompt. Write freely — Lumen reads for depth.', go: renderJournal };

    return h('button', { class: 'circuit-row' + (item.done ? ' circuit-done' : ''), onclick: meta.go },
      h('span', { class: 'circuit-icon' }, meta.icon),
      h('span', { class: 'circuit-text' },
        h('span', { class: 'circuit-name' }, meta.name),
        h('span', { class: 'circuit-blurb' }, item.done && item.score != null ? `Done — ${item.score}/100` : meta.blurb)),
      h('span', { class: 'circuit-state' }, item.done ? '✓' : '›'),
    );
  }

  /* =============== game screen =============== */

  function screenShell(title, body) {
    return h('div', { class: 'screen' },
      h('div', { class: 'screen-top' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: renderDashboard }, '‹ Back'),
        h('h1', { class: 'screen-title' }, title)),
      body);
  }

  function renderGame(gameId) {
    const game = window.Games.registry[gameId];
    const container = h('div', { class: 'game-box card' });
    root().replaceChildren(screenShell(`${game.icon} ${game.name}`, container));

    window.Games.play(gameId, container, (score, g, diff) => {
      const state = S();
      const today = window.Store.today();
      today.games[gameId] = { score, domain: g.domain };
      window.Scoring.adaptDifficulty(state, g.domain, score);
      checkDayComplete(state);
      window.Store.save();

      container.replaceChildren(
        h('div', { class: 'result-block' },
          h('div', { class: 'result-score' }, String(score)),
          h('p', { class: 'result-label' }, score >= 80 ? 'Excellent!' : score >= 55 ? 'Solid work.' : 'Tough one — it counts all the same.'),
          h('p', { class: 'game-hint' },
            score >= 75 ? 'That was strong — tomorrow\'s ' + g.domain + ' challenge steps up a level.' :
            score < 40 ? 'Tomorrow\'s ' + g.domain + ' challenge eases off a notch so you can build back up.' :
            'Difficulty holds steady. Consistency is what moves your score.'),
          h('button', { class: 'btn btn-primary btn-lg', onclick: renderDashboard }, 'Back to circuit')),
      );
    });
  }

  /* =============== EQ moment =============== */

  function renderEQ() {
    const dayIdx = window.Store.daysSinceEpoch(window.Store.todayISO());
    const rng = window.Games.seededRng(window.Store.todayISO() + ':eq');
    const base = window.DATA.eqScenarios[dayIdx % window.DATA.eqScenarios.length];
    const scenario = { title: base.title, situation: base.situation, options: window.Games.shuffle(base.options, rng) };
    const rawRead = window.DATA.emotionReads[dayIdx % window.DATA.emotionReads.length];
    const readOpts = window.Games.shuffle(rawRead.options.map((text, i) => ({ text, isAnswer: i === rawRead.answer })), rng);
    const read = { text: rawRead.text, why: rawRead.why, options: readOpts.map((o) => o.text), answer: readOpts.findIndex((o) => o.isAnswer) };
    const container = h('div', { class: 'game-box card' });
    root().replaceChildren(screenShell('💛 EQ Moment', container));

    let scenarioPts = 0;

    function showScenario() {
      container.replaceChildren(
        h('p', { class: 'eq-kicker' }, 'What would you do?'),
        h('h2', { class: 'eq-title' }, scenario.title),
        h('p', { class: 'game-q' }, scenario.situation),
        h('div', { class: 'options' },
          scenario.options.map((opt, i) =>
            h('button', { class: 'option-btn', onclick: (e) => pickScenario(i, e.currentTarget) }, opt.text))),
      );
    }

    function pickScenario(i, btn) {
      const chosen = scenario.options[i];
      scenarioPts = chosen.pts;
      const bestIdx = scenario.options.findIndex((o) => o.pts === 2);
      container.querySelectorAll('.option-btn').forEach((b, bi) => {
        b.disabled = true;
        if (bi === bestIdx) b.classList.add('opt-right');
      });
      if (chosen.pts < 2) btn.classList.add(chosen.pts === 1 ? 'opt-partial' : 'opt-wrong');
      container.append(
        h('div', { class: 'why-stack' },
          h('p', { class: 'why' }, h('strong', {}, chosen.pts === 2 ? 'Strong choice. ' : chosen.pts === 1 ? 'Decent instinct. ' : 'Worth a rethink. '), chosen.why),
          chosen.pts < 2 ? h('p', { class: 'why' }, h('strong', {}, 'The strongest move: '), scenario.options[bestIdx].why) : null),
        h('button', { class: 'btn btn-primary next-btn', onclick: showRead }, 'Next: read the room'),
      );
    }

    function showRead() {
      container.replaceChildren(
        h('p', { class: 'eq-kicker' }, 'Read the room'),
        h('p', { class: 'game-q' }, read.text),
        h('p', { class: 'game-hint' }, 'What is this person most likely feeling?'),
        h('div', { class: 'options' },
          read.options.map((opt, i) =>
            h('button', { class: 'option-btn', onclick: (e) => pickRead(i, e.currentTarget) }, opt))),
      );
    }

    function pickRead(i, btn) {
      const right = i === read.answer;
      container.querySelectorAll('.option-btn').forEach((b, bi) => {
        b.disabled = true;
        if (bi === read.answer) b.classList.add('opt-right');
      });
      if (!right) btn.classList.add('opt-wrong');

      const score = Math.round((scenarioPts / 2) * 70 + (right ? 30 : 0));
      const state = S();
      const today = window.Store.today();
      today.eqScore = score;
      checkDayComplete(state);
      window.Store.save();

      container.append(
        h('p', { class: 'why' }, read.why),
        h('div', { class: 'result-block' },
          h('div', { class: 'result-score' }, String(score)),
          h('p', { class: 'result-label' }, score >= 85 ? 'Emotionally sharp today.' : score >= 55 ? 'Good awareness — keep tuning in.' : 'These are learnable skills. Tomorrow brings a fresh situation.'),
          h('button', { class: 'btn btn-primary btn-lg', onclick: renderDashboard }, 'Back to circuit')),
      );
    }

    showScenario();
  }

  /* =============== journal =============== */

  function renderJournal() {
    const today = window.Store.today();
    const prompt = window.Journal.promptForDate(window.Store.todayISO());
    const container = h('div', { class: 'game-box card' });
    root().replaceChildren(screenShell('📓 Journal', container));

    if (today.journal) return showAnalysis(today.journal, today.journalText || '');

    const ta = h('textarea', { class: 'journal-ta', rows: 9, placeholder: 'Write freely — no one reads this but you (and it never leaves your browser).' });
    const counter = h('span', { class: 'wc' }, '0 words');
    ta.addEventListener('input', () => {
      const n = (ta.value.match(/[a-zA-Z']+/g) || []).length;
      counter.textContent = n + ' word' + (n === 1 ? '' : 's') + (n < 40 ? ' · aim for 40+' : ' ✓');
    });

    setChildren(container,
      h('p', { class: 'eq-kicker' }, 'Today\'s prompt'),
      h('p', { class: 'game-q' }, prompt),
      ta,
      h('div', { class: 'journal-bar' }, counter,
        h('button', {
          class: 'btn btn-primary', onclick: () => {
            const text = ta.value.trim();
            if (!text) { ta.focus(); return; }
            const analysis = window.Journal.analyze(text);
            const state = S();
            const t = window.Store.today();
            t.journal = analysis;
            t.journalText = text;
            state.journalEntries.push({ date: window.Store.todayISO(), prompt, text, analysis });
            checkDayComplete(state);
            window.Store.save();
            showAnalysis(analysis, text);
          },
        }, 'Save & analyse')),
      pastEntries(),
    );

    function showAnalysis(a, text) {
      setChildren(container,
        h('p', { class: 'eq-kicker' }, 'Entry saved'),
        h('div', { class: 'journal-scores' },
          h('div', { class: 'stat-tile' }, h('span', { class: 'stat-label' }, 'Depth of thought'), h('span', { class: 'stat-value' }, String(a.iqComponent))),
          h('div', { class: 'stat-tile' }, h('span', { class: 'stat-label' }, 'Emotional insight'), h('span', { class: 'stat-value' }, String(a.eqComponent)))),
        a.advancedWords.length
          ? h('div', { class: 'chip-row' }, a.advancedWords.slice(0, 8).map((w) => h('span', { class: 'chip' }, w)))
          : null,
        h('ul', { class: 'feedback-list' }, a.feedback.map((f) => h('li', {}, f))),
        h('p', { class: 'fineprint' }, `${a.wordCount} words · ${a.insightHits} reflective marker${a.insightHits === 1 ? '' : 's'} · ${a.emotionWords.length} emotion word${a.emotionWords.length === 1 ? '' : 's'}`),
        h('button', { class: 'btn btn-primary btn-lg', onclick: renderDashboard }, 'Back to circuit'),
        pastEntries(),
      );
    }

    function pastEntries() {
      const entries = S().journalEntries.slice(-14).reverse().filter((e) => e.date !== window.Store.todayISO());
      if (!entries.length) return null;
      return h('details', { class: 'journal-archive' },
        h('summary', {}, `Past entries (${entries.length})`),
        entries.map((e) => h('div', { class: 'archive-entry' },
          h('p', { class: 'archive-date' }, e.date + ' — ' + e.prompt),
          h('p', { class: 'archive-text' }, e.text))));
    }
  }

  /* =============== completion & celebration =============== */

  function checkDayComplete(state) {
    const today = window.Store.today();
    const circuit = window.Games.circuitFor(window.Store.todayISO());
    const gamesDone = circuit.every((id) => today.games[id] != null);
    if (gamesDone && today.eqScore != null && today.journal && !today.done) {
      today.done = true;
      window.Scoring.markDayComplete(state);
      renderDashboard._celebrated = false;
    }
  }

  function confetti() {
    const wrap = h('div', { class: 'confetti' });
    const glyphs = ['✦', '✳', '●', '▲', '■'];
    for (let i = 0; i < 36; i++) {
      wrap.append(h('span', {
        class: 'confetti-bit',
        style: `left:${Math.random() * 100}%;animation-delay:${Math.random() * 0.9}s;animation-duration:${2 + Math.random() * 1.5}s;font-size:${10 + Math.random() * 12}px`,
      }, glyphs[i % glyphs.length]));
    }
    document.body.append(wrap);
    setTimeout(() => wrap.remove(), 4200);
  }

  /* =============== weekly recap =============== */

  function recapBanner(recap) {
    const arrow = (d) => d > 0 ? ' ↑' + d : d < 0 ? ' ↓' + Math.abs(d) : ' —';
    return h('div', { class: 'card recap-card' },
      h('h2', {}, '📬 Weekly recalibration'),
      h('p', { class: 'card-sub' }, `Week of ${recap.weekStart} · ${recap.activeDays} active day${recap.activeDays === 1 ? '' : 's'}`),
      h('div', { class: 'recap-scores' },
        h('div', { class: 'stat-tile' },
          h('span', { class: 'stat-label' }, 'IQ index'),
          h('span', { class: 'stat-value' }, `${recap.iqBefore} → ${recap.iqAfter}`),
          h('span', { class: recap.dIQ >= 0 ? 'delta delta-up' : 'delta delta-down' }, 'performance ' + (recap.iqPerf ?? '—') + '/100' + arrow(recap.dIQ))),
        h('div', { class: 'stat-tile' },
          h('span', { class: 'stat-label' }, 'EQ index'),
          h('span', { class: 'stat-value' }, `${recap.eqBefore} → ${recap.eqAfter}`),
          h('span', { class: recap.dEQ >= 0 ? 'delta delta-up' : 'delta delta-down' }, 'awareness ' + (recap.eqPerf ?? '—') + '/100' + arrow(recap.dEQ)))),
      Object.keys(recap.domains).length ? h('div', { class: 'domain-bars' },
        Object.entries(recap.domains).map(([d, v]) =>
          h('div', { class: 'domain-bar' },
            h('span', { class: 'domain-name' }, d),
            h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${v}%` })),
            h('span', { class: 'domain-val' }, String(v))))) : null,
      h('p', { class: 'game-hint' },
        recap.dIQ + recap.dEQ > 0 ? 'The week paid off. New week, new baseline — keep the momentum.' :
        recap.dIQ + recap.dEQ < 0 ? 'A dip week — it happens to everyone. Showing up 5 days is the surest way back up.' :
        'You held steady. More active days give each session more pull on your score.'),
      h('button', {
        class: 'btn btn-primary', onclick: () => { S().pendingRecap = null; window.Store.save(); renderDashboard(); },
      }, 'Start the new week'),
    );
  }

  function pastWeeksCard(history) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Past weeks')),
      h('div', { class: 'history-list' },
        history.slice(-6).reverse().map((r) =>
          h('div', { class: 'history-row' },
            h('span', { class: 'history-week' }, 'Week of ' + r.weekStart),
            h('span', { class: 'history-days' }, r.activeDays + 'd active'),
            h('span', { class: r.dIQ >= 0 ? 'delta delta-up' : 'delta delta-down' }, 'IQ ' + (r.dIQ >= 0 ? '+' : '') + r.dIQ),
            h('span', { class: r.dEQ >= 0 ? 'delta delta-up' : 'delta delta-down' }, 'EQ ' + (r.dEQ >= 0 ? '+' : '') + r.dEQ)))),
    );
  }

  /* =============== trend chart (two series, hover tooltip) =============== */

  function trendChart(historyPoints) {
    if (!historyPoints || historyPoints.length < 2) {
      return h('p', { class: 'chart-empty' }, 'Your trend line appears after your first weekly recalibration. For now: today\'s circuit awaits.');
    }

    const W = 640, H = 220, padL = 40, padR = 46, padT = 16, padB = 28;
    const pts = historyPoints;
    const all = pts.flatMap((p) => [p.iq, p.eq]);
    const yMin = Math.floor((Math.min(...all) - 6) / 5) * 5;
    const yMax = Math.ceil((Math.max(...all) + 6) / 5) * 5;
    const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
    const path = (key) => pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p[key]).toFixed(1)).join(' ');

    const gridLines = [];
    const step = (yMax - yMin) <= 20 ? 5 : 10;
    for (let v = yMin; v <= yMax; v += step) {
      gridLines.push(`<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="grid-line"/>` +
        `<text x="${padL - 8}" y="${y(v) + 4}" class="axis-label" text-anchor="end">${v}</text>`);
    }
    const xLabels = pts.map((p, i) => {
      if (pts.length > 6 && i % 2 === 1 && i !== pts.length - 1) return '';
      const d = new Date(p.date + 'T12:00:00');
      const lbl = (d.getMonth() + 1) + '/' + d.getDate();
      return `<text x="${x(i)}" y="${H - 8}" class="axis-label" text-anchor="middle">${lbl}</text>`;
    }).join('');

    const last = pts.length - 1;
    const endLabel = (key, name) =>
      `<circle cx="${x(last)}" cy="${y(pts[last][key])}" r="3.5" class="pt-${key}"/>` +
      `<text x="${x(last) + 7}" y="${y(pts[last][key]) + 4}" class="series-end-label">${name}</text>`;

    const wrap = h('div', { class: 'chart-wrap' });
    wrap.innerHTML =
      `<div class="chart-legend">
         <span class="legend-item"><span class="legend-chip chip-iq"></span>IQ index</span>
         <span class="legend-item"><span class="legend-chip chip-eq"></span>EQ index</span>
       </div>
       <div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="IQ and EQ index over time">
         ${gridLines.join('')}${xLabels}
         <path d="${path('iq')}" class="line-iq" fill="none"/>
         <path d="${path('eq')}" class="line-eq" fill="none"/>
         ${endLabel('iq', 'IQ')}${endLabel('eq', 'EQ')}
         <line class="crosshair" y1="${padT}" y2="${H - padB}" style="display:none"/>
         ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.iq)}" r="3" class="pt-iq hover-pt" style="display:none" data-i="${i}"/>`).join('')}
         ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.eq)}" r="3" class="pt-eq hover-pt" style="display:none" data-i="${i}"/>`).join('')}
       </svg>
       <div class="chart-tip" style="display:none"></div></div>`;

    const svg = wrap.querySelector('svg');
    const tip = wrap.querySelector('.chart-tip');
    const cross = wrap.querySelector('.crosshair');
    svg.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * W;
      let best = 0, bestD = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(x(i) - mx); if (d < bestD) { bestD = d; best = i; } });
      cross.style.display = '';
      cross.setAttribute('x1', x(best)); cross.setAttribute('x2', x(best));
      wrap.querySelectorAll('.hover-pt').forEach((c) => { c.style.display = Number(c.dataset.i) === best ? '' : 'none'; });
      tip.style.display = '';
      tip.innerHTML = `<strong>${pts[best].date}</strong><br>IQ ${pts[best].iq} · EQ ${pts[best].eq}`;
      const left = (x(best) / W) * rect.width;
      tip.style.left = Math.min(rect.width - 130, Math.max(4, left + 10)) + 'px';
    });
    svg.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      cross.style.display = 'none';
      wrap.querySelectorAll('.hover-pt').forEach((c) => { c.style.display = 'none'; });
    });

    return wrap;
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
