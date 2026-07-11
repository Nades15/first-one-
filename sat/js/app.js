/* Summit — screens & wiring.
 * Question stems, options, and rationales are College Board HTML (or our
 * labeled samples) and render via innerHTML by design; everything the user
 * types is escaped with esc() before display. */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const app = () => $('#app');

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const DIFF_LABEL = { E: 'Easy', M: 'Medium', H: 'Hard' };
  const domainName = code => SMConfig.DOMAIN_NAMES[code] || code || '—';
  const sectionLabel = sec => (SMConfig.SECTIONS[sec] || { label: sec }).label;

  let tab = 'practice';
  let showUpgrade = false;
  let bank = null;                        // loaded question bank (or null → setup)
  let practice = { phase: 'idle' };       // + { q, picked, correct, res } in flight
  let mock = null;                        // { section, qs, i, answers, endsAt, timerId, done, results }
  let dl = { running: false, err: '' };   // in-app bank download state
  let redeemMsg = '';

  /* ============================ helpers ============================ */

  function capNow(s) {
    const daily = SMStore.touchDaily();
    return SMPremium.capInfo(daily.count, s.premium.active, SMConfig.FREE_DAILY_CAP);
  }

  function unseenPool(s, section) {
    if (!bank) return [];
    const focus = section || s.settings.focus;
    return bank.questions.filter(q =>
      !s.seen[q.id] && (focus === 'both' || q.section === focus));
  }

  function grade(q, input) {
    return q.type === 'mcq' ? q.correct.includes(input) : SMQnorm.matchesSpr(input, q.correct);
  }

  function mmss(ms) {
    const t = Math.max(0, Math.round(ms / 1000));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function accuracyOf(entries) {
    if (!entries.length) return null;
    return entries.filter(e => e.correct).length / entries.length;
  }

  /* ============================= shell ============================= */

  function render() {
    const s = SMStore.load();
    if (!s.settings.onboarded) { renderOnboarding(); return; }
    if (!bank) { renderSetup(); return; }

    const cap = capNow(s);
    SMStore.save();
    const est = s.profile ? SMAdaptive.estimateScores(s.profile) : null;

    app().innerHTML =
      '<header class="topbar">' +
        '<div class="brand">⛰️ Summit</div>' +
        '<div class="topbar-stats">' +
          (bank.meta.sample ? '<span class="chip chip-warn">sample questions</span>' : '') +
          '<span class="chip">🔥 ' + (s.streak.count || 0) + '</span>' +
          (s.premium.active
            ? '<span class="chip chip-good">est ' + (est ? est.total : '—') + '</span>'
            : '<button class="chip chip-accent" id="chip-up">🔒 est score</button>') +
        '</div>' +
      '</header>' +
      '<main class="screen" id="screen"></main>' +
      '<nav class="tabbar">' + ['practice', 'mock', 'stats', 'settings'].map(t =>
        '<button class="tabbtn' + (tab === t && !showUpgrade ? ' active' : '') + '" data-tab="' + t + '">' +
        { practice: '📝<span>Practice</span>', mock: '⏱️<span>Mock</span>',
          stats: '📊<span>Stats</span>', settings: '⚙️<span>Settings</span>' }[t] +
        '</button>').join('') +
      '</nav>';

    app().querySelectorAll('.tabbtn').forEach(b => b.onclick = () => {
      tab = b.dataset.tab; showUpgrade = false; redeemMsg = ''; render();
    });
    const up = $('#chip-up');
    if (up) up.onclick = openUpgrade;

    if (showUpgrade) renderUpgrade(cap);
    else ({ practice: renderPractice, mock: renderMock, stats: renderStats, settings: renderSettings })[tab]();
  }

  function openUpgrade() { showUpgrade = true; redeemMsg = ''; render(); }

  /* ========================== onboarding =========================== */

  function renderOnboarding() {
    app().innerHTML =
      '<main class="screen welcome">' +
        '<div class="logo-big">⛰️</div>' +
        '<h1>Summit</h1>' +
        '<p class="tagline">Real SAT practice questions from College Board\'s official question bank — served adaptively. Tell Summit where you are, and every answer tunes what comes next: get questions right and they climb toward test-day hard; struggle and they ease off until you\'re ready.</p>' +
        '<div class="card form-card">' +
          '<strong>Where are you starting from?</strong>' +
          '<p class="hint">A recent SAT, PSAT, or practice-test score sets your starting difficulty. No score yet? Leave these blank — Summit calibrates itself within your first ~10 questions either way.</p>' +
          '<div class="form-grid">' +
            '<label>Reading &amp; Writing<input id="ob-rw" type="number" min="200" max="800" step="10" placeholder="200–800" inputmode="numeric"></label>' +
            '<label>Math<input id="ob-math" type="number" min="200" max="800" step="10" placeholder="200–800" inputmode="numeric"></label>' +
          '</div>' +
          '<label>Practice focus<select id="ob-focus">' +
            '<option value="both">Both sections (recommended)</option>' +
            '<option value="rw">Reading &amp; Writing only</option>' +
            '<option value="math">Math only</option>' +
          '</select></label>' +
          '<button class="btn btn-primary btn-lg" id="ob-go">Start climbing</button>' +
          '<p class="fineprint">Free: ' + SMConfig.FREE_DAILY_CAP + ' adaptive questions a day with official explanations. Everything stays in this browser — nothing is uploaded anywhere.</p>' +
        '</div>' +
      '</main>';
    $('#ob-go').onclick = () => {
      const s = SMStore.load();
      s.profile = SMAdaptive.initProfile({
        rw: Number($('#ob-rw').value) || undefined,
        math: Number($('#ob-math').value) || undefined,
      });
      s.settings.focus = $('#ob-focus').value;
      s.settings.onboarded = true;
      SMStore.save();
      render();
    };
  }

  /* ====================== setup (no bank yet) ====================== */

  function renderSetup() {
    app().innerHTML =
      '<main class="screen welcome">' +
        '<div class="logo-big">⛰️</div>' +
        '<h1>One-time setup</h1>' +
        '<p class="tagline">Summit uses <strong>real College Board questions</strong>, not made-up ones — so the first step is downloading the official question bank (~3,000 digital-SAT questions) straight from College Board into this browser.</p>' +
        '<div class="card form-card" id="setup-card">' +
          (dl.running
            ? '<strong>Downloading the official question bank…</strong>' +
              '<div class="bar-track"><div class="bar-fill" id="dl-bar" style="width:0%"></div></div>' +
              '<p class="muted" id="dl-txt">Fetching question lists…</p>' +
              '<p class="fineprint">A few minutes on a normal connection. Safe to interrupt — it resumes where it left off.</p>'
            : '<button class="btn btn-primary btn-lg" id="dl-go">Download official questions</button>' +
              (dl.err ? '<p class="error-text">' + esc(dl.err) + '</p>' : '') +
              '<p class="fineprint">Comes straight from College Board\'s public question-bank API and stays on this device. Prefer the command line? From the repo: <code>node sat/tools/fetch-bank.mjs</code>, then reload. Just exploring? Add <code>?mock=1</code> to the URL for a small sample bank.</p>') +
        '</div>' +
      '</main>';
    const go = $('#dl-go');
    if (go) go.onclick = startDownload;
  }

  async function startDownload() {
    const s = SMStore.load();
    dl = { running: true, err: '' };
    if (!bank) renderSetup(); else renderSettings();
    try {
      await SMBank.download((done, total) => {
        const bar = $('#dl-bar'), txt = $('#dl-txt');
        if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
        if (txt) txt.textContent = done + ' / ' + total + ' questions';
      }, { corsProxy: s.settings.corsProxy });
      bank = SMBank.current();
      dl = { running: false, err: '' };
    } catch (e) {
      dl = { running: false, err: 'Download failed: ' + (e && e.message ? e.message : e) +
        '. Check your connection and try again — progress so far is kept.' };
    }
    render();
  }

  /* ============================ practice =========================== */

  function renderPractice() {
    if (practice.phase === 'question') return renderQuestion();
    if (practice.phase === 'feedback') return renderFeedback();

    const s = SMStore.load();
    const daily = SMStore.touchDaily();
    const cap = capNow(s);
    const est = s.profile ? SMAdaptive.estimateScores(s.profile) : null;
    const weak = s.profile ? SMAdaptive.weakestDomain(s.profile) : null;
    const pool = unseenPool(s);

    $('#screen').innerHTML =
      '<div class="card">' +
        '<div class="card-head"><h2>Today</h2><span class="card-sub">' +
          (s.premium.active ? 'unlimited practice' : 'free plan') + '</span></div>' +
        '<div class="statgrid">' +
          '<div class="stat"><b>' + daily.count + (s.premium.active ? '' : '<small>/' + SMConfig.FREE_DAILY_CAP + '</small>') + '</b><span>questions</span></div>' +
          '<div class="stat"><b>' + (daily.count ? Math.round(daily.correct / daily.count * 100) + '%' : '—') + '</b><span>accuracy</span></div>' +
          (s.premium.active
            ? '<div class="stat"><b>' + (est ? est.total : '—') + '</b><span>est score</span></div>'
            : '<div class="stat" id="stat-lock"><b class="lock">🔒</b><span>est score</span></div>') +
        '</div>' +
        (weak ? '<p class="muted">Focus area: <strong>' + esc(domainName(weak.domain)) + '</strong> — Summit is steering extra questions there.</p>' : '') +
        (bank.meta.sample ? '<p class="fineprint">You\'re on the small sample bank — download the real College Board bank in Settings for the full experience.</p>' : '') +
      '</div>' +
      (cap.capped ? cappedCard() :
        '<div class="card">' +
          '<button class="btn btn-primary btn-lg" id="pr-go"' + (pool.length ? '' : ' disabled') + '>' +
            (daily.count ? 'Keep practising' : 'Start practising') +
            (s.premium.active ? '' : ' (' + cap.remaining + ' left today)') + '</button>' +
          (pool.length ? '' : '<p class="muted">No unseen questions left in this focus — change focus in Settings or reset progress.</p>') +
        '</div>');

    const go = $('#pr-go');
    if (go) go.onclick = startQuestion;
    const lock = $('#stat-lock');
    if (lock) { lock.style.cursor = 'pointer'; lock.onclick = openUpgrade; }
    const upBtn = $('#cap-up');
    if (upBtn) upBtn.onclick = openUpgrade;
  }

  function cappedCard() {
    return '<div class="card">' +
      '<div class="card-head"><h2>That\'s ' + SMConfig.FREE_DAILY_CAP + ' for today 🎉</h2></div>' +
      '<p class="muted">Nice work — the free plan resets at midnight. Want to keep climbing right now?</p>' +
      '<ul class="feature-list">' +
        '<li class="yes">Unlimited adaptive questions</li>' +
        '<li class="yes">Timed mock modules with review</li>' +
        '<li class="yes">Live score prediction &amp; trend</li>' +
        '<li class="yes">Weakness analytics by domain &amp; skill</li>' +
      '</ul>' +
      '<button class="btn btn-primary" id="cap-up">See Summit Premium</button>' +
    '</div>';
  }

  function startQuestion() {
    const s = SMStore.load();
    if (capNow(s).capped) { practice = { phase: 'idle' }; render(); return; }
    const pool = unseenPool(s);
    const q = SMAdaptive.selectQuestion(pool, s.profile);
    if (!q) { practice = { phase: 'idle' }; render(); return; }
    practice = { phase: 'question', q, picked: null };
    render();
    window.scrollTo(0, 0);
  }

  function questionHead(q, extra) {
    return '<div class="qmeta">' +
      '<span class="chip">' + esc(sectionLabel(q.section)) + '</span>' +
      '<span class="chip">' + esc(domainName(q.domain)) + '</span>' +
      '<span class="chip diff-' + esc(q.difficulty || 'M') + '">' + (DIFF_LABEL[q.difficulty] || 'Medium') + '</span>' +
      (extra || '') +
    '</div>';
  }

  function questionBody(q) {
    return (q.stimulus ? '<div class="stimulus">' + q.stimulus + '</div>' : '') +
      '<div class="stem">' + q.stem + '</div>';
  }

  function renderQuestion() {
    const q = practice.q;
    $('#screen').innerHTML =
      '<div class="card">' +
        questionHead(q) +
        questionBody(q) +
        (q.type === 'mcq'
          ? '<div class="opts">' + q.options.map(o =>
              '<button class="opt' + (practice.picked === o.letter ? ' sel' : '') + '" data-letter="' + o.letter + '">' +
                '<span class="letter">' + o.letter + '</span><div>' + o.html + '</div>' +
              '</button>').join('') + '</div>'
          : '<label>Your answer<input class="spr-input" id="spr" inputmode="decimal" autocomplete="off" ' +
              'placeholder="e.g. 5 or 3/4" value="' + esc(practice.picked || '') + '"></label>') +
        '<div class="row-gap">' +
          '<button class="btn btn-primary" id="q-check" disabled>Check</button>' +
          '<button class="btn btn-ghost" id="q-quit">Save for later</button>' +
        '</div>' +
      '</div>';

    const check = $('#q-check');
    if (q.type === 'mcq') {
      app().querySelectorAll('.opt').forEach(b => b.onclick = () => {
        practice.picked = b.dataset.letter;
        app().querySelectorAll('.opt').forEach(x => x.classList.toggle('sel', x === b));
        check.disabled = false;
      });
      check.disabled = practice.picked == null;
    } else {
      const inp = $('#spr');
      inp.oninput = () => { practice.picked = inp.value; check.disabled = !inp.value.trim(); };
      check.disabled = !(practice.picked || '').trim();
    }
    check.onclick = submitAnswer;
    $('#q-quit').onclick = () => { practice = { phase: 'idle' }; render(); };
  }

  function submitAnswer() {
    const s = SMStore.load();
    const q = practice.q;
    const correct = grade(q, practice.picked);
    const res = SMAdaptive.applyAnswer(s.profile, q, correct);
    SMStore.recordAnswer(q, correct, 'practice');
    practice = { phase: 'feedback', q, picked: practice.picked, correct, res };
    render();
  }

  function renderFeedback() {
    const s = SMStore.load();
    const { q, picked, correct, res } = practice;
    const cap = capNow(s);
    const answerLabel = q.type === 'mcq' ? q.correct.join(', ') : q.correct.join(' or ');
    const adaptNote = res.delta > 1.2 ? 'Level up — questions are getting harder ⬆'
      : res.delta < -1.2 ? 'Easing off a touch so you can build back up ⬇'
      : 'Score estimate updated';

    $('#screen').innerHTML =
      '<div class="card">' +
        questionHead(q) +
        questionBody(q) +
        (q.type === 'mcq'
          ? '<div class="opts">' + q.options.map(o => {
              const cls = q.correct.includes(o.letter) ? ' correct' : (o.letter === picked ? ' wrong' : '');
              return '<button class="opt' + cls + '" disabled><span class="letter">' + o.letter + '</span><div>' + o.html + '</div></button>';
            }).join('') + '</div>'
          : '<p>Your answer: <strong class="' + (correct ? 'good' : 'bad') + '">' + esc(picked) + '</strong></p>') +
        '<div class="verdict ' + (correct ? 'verdict-good' : 'verdict-bad') + '">' +
          (correct ? '✓ Correct' : '✗ Not quite — the answer is ' + esc(answerLabel)) + '</div>' +
        (q.rationale ? '<div class="rationale"><strong>Why</strong>' + q.rationale + '</div>' : '') +
        '<p class="adapt-note">' + adaptNote + '</p>' +
        '<div class="row-gap">' +
          (cap.capped
            ? '<button class="btn btn-primary" id="q-done">Done for today</button>'
            : '<button class="btn btn-primary" id="q-next">Next question</button>') +
          '<button class="btn btn-ghost" id="q-stop">Take a break</button>' +
        '</div>' +
      '</div>';

    const next = $('#q-next');
    if (next) next.onclick = startQuestion;
    const done = $('#q-done');
    if (done) done.onclick = () => { practice = { phase: 'idle' }; render(); };
    $('#q-stop').onclick = () => { practice = { phase: 'idle' }; render(); };
  }

  /* ============================== mock ============================= */

  function renderMock() {
    const s = SMStore.load();
    if (!s.premium.active) {
      $('#screen').innerHTML =
        '<div class="card">' +
          '<div class="card-head"><h2>⏱️ Timed mock modules</h2><span class="chip premium-badge">Premium</span></div>' +
          '<p class="muted">A full digital-SAT module against the clock — ' + SMConfig.MOCKS.rw.questions + ' Reading &amp; Writing questions in ' + SMConfig.MOCKS.rw.minutes + ' minutes, or ' + SMConfig.MOCKS.math.questions + ' Math in ' + SMConfig.MOCKS.math.minutes + '. No feedback until the end, then a full review with official explanations, and your score estimate updates from the result.</p>' +
          '<button class="btn btn-primary" id="mk-up">Unlock with Premium</button>' +
        '</div>';
      $('#mk-up').onclick = openUpgrade;
      return;
    }
    if (mock && !mock.done) return renderMockQuestion();
    if (mock && mock.done) return renderMockResults();

    const cards = Object.keys(SMConfig.MOCKS).map(sec => {
      const spec = SMConfig.MOCKS[sec];
      const avail = unseenPool(s, sec).length;
      const n = Math.min(spec.questions, avail);
      return '<div class="card">' +
        '<div class="card-head"><h2>' + esc(sectionLabel(sec)) + '</h2>' +
          '<span class="card-sub">' + spec.questions + ' questions · ' + spec.minutes + ' min</span></div>' +
        (avail === 0
          ? '<p class="muted">No unseen questions left in this section.</p>'
          : (n < spec.questions ? '<p class="muted">Only ' + n + ' unseen questions left — this mock will be shorter.</p>' : '')) +
        '<button class="btn btn-primary" data-mock="' + sec + '"' + (avail === 0 ? ' disabled' : '') + '>Start ' + esc(sectionLabel(sec)) + ' mock</button>' +
      '</div>';
    }).join('');
    $('#screen').innerHTML = cards +
      (s.mocks.length ? '<div class="card"><div class="card-head"><h2>Past mocks</h2></div>' +
        s.mocks.slice(-5).reverse().map(m =>
          '<p class="muted">' + new Date(m.at).toLocaleDateString() + ' — ' + esc(sectionLabel(m.section)) +
          ': <strong>' + m.correct + '/' + m.total + '</strong> · est ' + m.est + '</p>').join('') + '</div>' : '');
    app().querySelectorAll('[data-mock]').forEach(b => b.onclick = () => startMock(b.dataset.mock));
  }

  function startMock(section) {
    const s = SMStore.load();
    const spec = SMConfig.MOCKS[section];
    const qs = SMAdaptive.mockDraw(unseenPool(s, section), spec.questions);
    if (!qs.length) return;
    mock = {
      section, qs, i: 0,
      answers: new Array(qs.length).fill(null),
      endsAt: Date.now() + spec.minutes * 60e3,
      timerId: setInterval(tickMock, 500),
      done: false,
    };
    render();
    window.scrollTo(0, 0);
  }

  function tickMock() {
    if (!mock || mock.done) return;
    const left = mock.endsAt - Date.now();
    const el = $('#mock-timer');
    if (el) {
      el.textContent = mmss(left);
      el.classList.toggle('low', left < 5 * 60e3);
    }
    if (left <= 0) finishMock();
  }

  function renderMockQuestion() {
    const q = mock.qs[mock.i];
    $('#screen').innerHTML =
      '<div class="card">' +
        '<div class="mock-head">' +
          '<span class="muted">Question ' + (mock.i + 1) + ' of ' + mock.qs.length + '</span>' +
          '<span class="mock-timer" id="mock-timer">' + mmss(mock.endsAt - Date.now()) + '</span>' +
        '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + Math.round(mock.i / mock.qs.length * 100) + '%"></div></div>' +
        questionHead(q) +
        questionBody(q) +
        (q.type === 'mcq'
          ? '<div class="opts">' + q.options.map(o =>
              '<button class="opt" data-letter="' + o.letter + '"><span class="letter">' + o.letter + '</span><div>' + o.html + '</div></button>').join('') + '</div>'
          : '<label>Your answer<input class="spr-input" id="mock-spr" inputmode="decimal" autocomplete="off" placeholder="e.g. 5 or 3/4"></label>') +
        '<div class="row-gap">' +
          (q.type === 'mcq' ? '' : '<button class="btn btn-primary" id="mock-submit" disabled>Submit</button>') +
          '<button class="btn btn-ghost" id="mock-skip">Skip</button>' +
          '<button class="btn btn-ghost btn-danger" id="mock-quit">End mock</button>' +
        '</div>' +
      '</div>';

    if (q.type === 'mcq') {
      app().querySelectorAll('.opt').forEach(b => b.onclick = () => answerMock(b.dataset.letter));
    } else {
      const inp = $('#mock-spr'), sub = $('#mock-submit');
      inp.oninput = () => { sub.disabled = !inp.value.trim(); };
      sub.onclick = () => answerMock(inp.value);
      inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) answerMock(inp.value); };
    }
    $('#mock-skip').onclick = () => answerMock(null);
    $('#mock-quit').onclick = () => {
      if (confirm('End this mock now? Answered questions still count.')) finishMock();
    };
  }

  function answerMock(input) {
    mock.answers[mock.i] = input;
    mock.i++;
    if (mock.i >= mock.qs.length) finishMock();
    else { render(); window.scrollTo(0, 0); }
  }

  function finishMock() {
    if (!mock || mock.done) return;
    clearInterval(mock.timerId);
    const s = SMStore.load();
    /* Only questions actually reached count — a skip is a wrong answer, but
     * questions beyond a quit/timeout stay unseen for future practice. */
    const results = mock.qs.slice(0, mock.i).map((q, i) => {
      const correct = grade(q, mock.answers[i]);
      SMAdaptive.applyAnswer(s.profile, q, correct, { kFactor: SMAdaptive.DEFAULTS.MOCK_K_FACTOR });
      SMStore.recordAnswer(q, correct, 'mock');
      return { q, picked: mock.answers[i], correct };
    });
    const nCorrect = results.filter(r => r.correct).length;
    const est = SMAdaptive.estimateScores(s.profile);
    s.mocks.push({ at: Date.now(), section: mock.section, correct: nCorrect, total: results.length, est: est[mock.section] });
    SMStore.save();
    mock.done = true;
    mock.results = results;
    mock.nCorrect = nCorrect;
    render();
    window.scrollTo(0, 0);
  }

  function renderMockResults() {
    const s = SMStore.load();
    const est = SMAdaptive.estimateScores(s.profile);
    $('#screen').innerHTML =
      '<div class="card">' +
        '<div class="card-head"><h2>' + esc(sectionLabel(mock.section)) + ' mock — done</h2></div>' +
        (mock.results.length < mock.qs.length
          ? '<p class="muted">' + (mock.qs.length - mock.results.length) + ' questions weren\'t reached — they stay in your practice pool.</p>' : '') +
        '<div class="statgrid">' +
          '<div class="stat"><b>' + mock.nCorrect + '/' + mock.results.length + '</b><span>correct</span></div>' +
          '<div class="stat"><b>' + est[mock.section] + '</b><span>est ' + esc(sectionLabel(mock.section)) + '</span></div>' +
          '<div class="stat"><b>' + est.total + '</b><span>est total</span></div>' +
        '</div>' +
        '<button class="btn btn-primary" id="mk-done">Back to mocks</button>' +
      '</div>' +
      '<div class="card"><div class="card-head"><h2>Review</h2><span class="card-sub">tap a question to see why</span></div>' +
        mock.results.map((r, i) =>
          '<details class="review-item"><summary>' +
            '<span class="' + (r.correct ? 'good' : 'bad') + '">' + (r.correct ? '✓' : '✗') + '</span>' +
            '<span>Q' + (i + 1) + ' · ' + esc(domainName(r.q.domain)) + ' · ' + (DIFF_LABEL[r.q.difficulty] || 'Medium') +
            (r.picked == null ? ' · skipped' : '') + '</span>' +
          '</summary>' +
          '<div class="stem" style="margin-top:8px">' + r.q.stem + '</div>' +
          '<p class="muted">Your answer: ' + esc(r.picked == null ? '—' : r.picked) +
            ' · Correct: ' + esc(r.q.correct.join(', ')) + '</p>' +
          (r.q.rationale ? '<div class="rationale">' + r.q.rationale + '</div>' : '') +
          '</details>').join('') +
      '</div>';
    $('#mk-done').onclick = () => { mock = null; render(); };
  }

  /* ============================== stats ============================ */

  function renderStats() {
    const s = SMStore.load();
    const entries = Object.values(s.seen);
    const est = s.profile ? SMAdaptive.estimateScores(s.profile) : null;

    const secBars = ['rw', 'math'].map(sec => {
      const acc = accuracyOf(entries.filter(e => e.section === sec));
      return barRow(sectionLabel(sec), acc, entries.filter(e => e.section === sec).length);
    }).join('');

    let html =
      '<div class="card">' +
        '<div class="card-head"><h2>Progress</h2><span class="card-sub">' + entries.length + ' questions answered</span></div>' +
        '<div class="statgrid">' +
          '<div class="stat"><b>' + entries.length + '</b><span>answered</span></div>' +
          '<div class="stat"><b>' + (entries.length ? Math.round(accuracyOf(entries) * 100) + '%' : '—') + '</b><span>accuracy</span></div>' +
          '<div class="stat"><b>' + (s.streak.count || 0) + '</b><span>day streak</span></div>' +
        '</div>' +
        (entries.length ? secBars : '<p class="muted">Answer a few questions and your progress shows up here.</p>') +
      '</div>';

    if (s.premium.active) {
      html += '<div class="card">' +
        '<div class="card-head"><h2>Score prediction</h2><span class="card-sub">from your adaptive rating</span></div>' +
        '<div class="statgrid">' +
          '<div class="stat"><b>' + (est ? est.total : '—') + '</b><span>total</span></div>' +
          '<div class="stat"><b>' + (est ? est.rw : '—') + '</b><span>R&amp;W</span></div>' +
          '<div class="stat"><b>' + (est ? est.math : '—') + '</b><span>Math</span></div>' +
        '</div>' +
        (s.history.length >= 2 ? sparkline(s.history) : '<p class="muted">The trend line appears after a few answers.</p>') +
      '</div>' +
      domainCard(s, entries) + skillCard(entries);
    } else {
      html += '<div class="card">' +
        '<div class="card-head"><h2>Score prediction &amp; weak spots</h2><span class="chip premium-badge">Premium</span></div>' +
        '<div class="locked-teaser"><div class="statgrid">' +
          '<div class="stat"><b>1250</b><span>total</span></div>' +
          '<div class="stat"><b>640</b><span>R&amp;W</span></div>' +
          '<div class="stat"><b>610</b><span>Math</span></div>' +
        '</div></div>' +
        '<p class="muted">Premium tracks your predicted 400–1600 score after every answer and breaks your accuracy down by domain and skill, so you always know what to drill next.</p>' +
        '<button class="btn btn-primary" id="st-up">See Summit Premium</button>' +
      '</div>';
    }
    $('#screen').innerHTML = html;

    const up = $('#st-up');
    if (up) up.onclick = openUpgrade;
    wireSparkline(s.history);
  }

  function barRow(label, acc, n) {
    const pct = acc == null ? 0 : Math.round(acc * 100);
    return '<div class="bar-row">' +
      '<div class="bar-label"><span>' + esc(label) + ' <span class="muted">· ' + n + '</span></span>' +
        '<b>' + (acc == null ? '—' : pct + '%') + '</b></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
  }

  function domainCard(s, entries) {
    const codes = Object.keys(SMConfig.DOMAIN_NAMES).filter(c => entries.some(e => e.domain === c));
    if (!codes.length) return '';
    return '<div class="card"><div class="card-head"><h2>By domain</h2><span class="card-sub">accuracy</span></div>' +
      codes.map(c => {
        const sub = entries.filter(e => e.domain === c);
        return barRow(domainName(c), accuracyOf(sub), sub.length);
      }).join('') + '</div>';
  }

  function skillCard(entries) {
    const bySkill = {};
    for (const e of entries) {
      if (!e.skill) continue;
      (bySkill[e.skill] = bySkill[e.skill] || []).push(e);
    }
    const rows = Object.keys(bySkill)
      .filter(k => bySkill[k].length >= 2)
      .map(k => ({ skill: k, acc: accuracyOf(bySkill[k]), n: bySkill[k].length }))
      .sort((a, b) => a.acc - b.acc)
      .slice(0, 6);
    if (!rows.length) return '';
    return '<div class="card"><div class="card-head"><h2>Skills to drill</h2><span class="card-sub">lowest accuracy first</span></div>' +
      rows.map(r => barRow(r.skill, r.acc, r.n)).join('') + '</div>';
  }

  /* Single-series score trend: 2px line, soft area, last-point label,
   * hover/touch readout. Values read in ink, not the series color. */
  function sparkline(history) {
    const W = 320, H = 80, PX = 6, PT = 12, PB = 14;
    const vals = history.map(h => h.total);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(hi - lo, 20);
    const x = i => PX + i / Math.max(vals.length - 1, 1) * (W - 2 * PX);
    const y = v => PT + (1 - (v - lo) / span) * (H - PT - PB);
    const pts = vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    const lastX = x(vals.length - 1), lastY = y(vals[vals.length - 1]);
    return '<div class="spark-wrap">' +
      '<svg class="spark" id="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Estimated total score trend">' +
        '<polyline points="' + pts + ' ' + lastX.toFixed(1) + ',' + (H - PB) + ' ' + PX + ',' + (H - PB) + '" fill="var(--accent)" opacity="0.12" stroke="none"/>' +
        '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle id="spark-dot" cx="' + lastX + '" cy="' + lastY + '" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>' +
        '<text x="' + (lastX - 4) + '" y="' + (lastY - 7) + '" text-anchor="end" font-size="11" fill="var(--ink)" id="spark-last">' + vals[vals.length - 1] + '</text>' +
      '</svg>' +
      '<div class="spark-read" id="spark-read">est ' + vals[vals.length - 1] + ' · last ' + vals.length + ' answers</div>' +
    '</div>';
  }

  function wireSparkline(history) {
    const svg = $('#spark');
    if (!svg || history.length < 2) return;
    const W = 320, PX = 6;
    svg.addEventListener('pointermove', ev => {
      const rect = svg.getBoundingClientRect();
      const fx = (ev.clientX - rect.left) / rect.width * W;
      const i = Math.max(0, Math.min(history.length - 1,
        Math.round((fx - PX) / (W - 2 * PX) * (history.length - 1))));
      const h = history[i];
      const dot = $('#spark-dot'), read = $('#spark-read');
      if (dot) {
        dot.setAttribute('cx', PX + i / (history.length - 1) * (W - 2 * PX));
        const vals = history.map(x => x.total);
        const lo = Math.min(...vals), span = Math.max(Math.max(...vals) - lo, 20);
        dot.setAttribute('cy', 12 + (1 - (h.total - lo) / span) * (80 - 12 - 14));
      }
      if (read) read.textContent = 'est ' + h.total + ' (R&W ' + h.rw + ' · Math ' + h.math + ') — ' +
        new Date(h.t).toLocaleDateString();
    });
  }

  /* ============================ upgrade ============================ */

  function renderUpgrade(cap) {
    const s = SMStore.load();
    const P = SMConfig.PRICING;
    $('#screen').innerHTML =
      '<div class="card">' +
        '<div class="card-head"><h2>⛰️ Summit Premium</h2>' +
          '<button class="btn btn-ghost btn-sm" id="up-back">← Back</button></div>' +
        (s.premium.active
          ? '<p class="good">Premium is active on this device' + (s.premium.code ? ' (code ' + esc(s.premium.code) + ')' : '') + '. Climb on!</p>'
          : '<p class="muted">Free gets you ' + SMConfig.FREE_DAILY_CAP + ' adaptive questions a day' +
            (cap && cap.capped ? ' — you\'ve used today\'s.' : '.') + ' Premium removes every limit:</p>' +
          '<ul class="feature-list">' +
            '<li class="yes"><strong>Unlimited</strong> adaptive questions, every day</li>' +
            '<li class="yes"><strong>Timed mock modules</strong> with full review</li>' +
            '<li class="yes"><strong>Score prediction</strong> — live 400–1600 estimate &amp; trend</li>' +
            '<li class="yes"><strong>Weakness analytics</strong> by domain and skill</li>' +
            '<li class="no">Free plan: ' + SMConfig.FREE_DAILY_CAP + ' questions/day, basic stats</li>' +
          '</ul>' +
          '<div class="price-grid">' +
            '<div class="price-card"><div class="price">' + P.monthly.price + '</div><div class="per">' + P.monthly.per + '</div></div>' +
            '<div class="price-card featured"><span class="tag">' + esc(P.yearly.tag) + '</span><div class="price">' + P.yearly.price + '</div><div class="per">' + P.yearly.per + '</div></div>' +
          '</div>' +
          '<button class="btn btn-primary btn-lg" disabled>Purchase — coming with the app-store release</button>' +
          '<p class="fineprint">Payments aren\'t wired up yet. Have an unlock code? Redeem it below — codes are how early access works for now.</p>') +
      '</div>' +
      (s.premium.active ? '' :
        '<div class="card form-card">' +
          '<label>Unlock code<input id="up-code" placeholder="SUMMIT-XXXX-XXXX" autocomplete="off"></label>' +
          (redeemMsg ? '<p class="error-text">' + esc(redeemMsg) + '</p>' : '') +
          '<button class="btn btn-primary" id="up-redeem">Redeem</button>' +
        '</div>');
    $('#up-back').onclick = () => { showUpgrade = false; render(); };
    const redeem = $('#up-redeem');
    if (redeem) redeem.onclick = () => redeemCode($('#up-code').value);
  }

  function redeemCode(code) {
    const s = SMStore.load();
    if (SMPremium.validateCode(code, SMConfig.CODE_SALT)) {
      s.premium = { active: true, code: code.trim().toUpperCase(), since: Date.now() };
      SMStore.save();
      showUpgrade = false;
      redeemMsg = '';
    } else {
      redeemMsg = 'That code doesn\'t check out — codes look like SUMMIT-XXXX-XXXX.';
    }
    render();
  }

  /* ============================ settings =========================== */

  function renderSettings() {
    const s = SMStore.load();
    const meta = bank ? bank.meta : {};
    $('#screen').innerHTML =
      '<div class="card form-card">' +
        '<div class="card-head"><h2>Question bank</h2></div>' +
        '<p class="muted">' +
          (bank
            ? bank.questions.length + ' questions · ' + esc(meta.source || 'unknown source') +
              (meta.fetchedAt ? ' · fetched ' + new Date(meta.fetchedAt).toLocaleDateString() : '') +
              (meta.failed ? ' · <span class="bad">' + meta.failed + ' failed — download again to retry</span>' : '')
            : 'No questions loaded yet.') + '</p>' +
        (dl.running
          ? '<div class="bar-track"><div class="bar-fill" id="dl-bar" style="width:0%"></div></div><p class="muted" id="dl-txt">…</p>'
          : '<div class="row-gap">' +
              '<button class="btn" id="set-dl">' + (bank && !meta.sample ? 'Update from College Board' : 'Download official questions') + '</button>' +
              '<button class="btn btn-ghost btn-danger" id="set-clearbank">Delete downloaded bank</button>' +
            '</div>') +
        (dl.err ? '<p class="error-text">' + esc(dl.err) + '</p>' : '') +
        '<label>CORS proxy <span class="hint">(only used if College Board blocks direct browser calls)</span>' +
          '<input id="set-proxy" value="' + esc(s.settings.corsProxy) + '"></label>' +
        '<p class="fineprint">Command-line alternative: <code>node sat/tools/fetch-bank.mjs</code> writes sat/data/bank.json, which loads automatically.</p>' +
      '</div>' +

      '<div class="card form-card">' +
        '<div class="card-head"><h2>Practice</h2></div>' +
        '<label>Focus<select id="set-focus">' +
          ['both', 'rw', 'math'].map(f => '<option value="' + f + '"' + (s.settings.focus === f ? ' selected' : '') + '>' +
            (f === 'both' ? 'Both sections' : sectionLabel(f)) + '</option>').join('') +
        '</select></label>' +
      '</div>' +

      '<div class="card form-card">' +
        '<div class="card-head"><h2>Premium</h2>' +
          (s.premium.active ? '<span class="chip premium-badge">active</span>' : '<span class="chip">free plan</span>') + '</div>' +
        (s.premium.active
          ? '<p class="muted">Unlocked ' + (s.premium.since ? new Date(s.premium.since).toLocaleDateString() : '') +
              (s.premium.code ? ' with ' + esc(s.premium.code) : '') + '.</p>' +
            '<button class="btn btn-ghost btn-danger" id="set-unpremium">Deactivate on this device</button>'
          : '<button class="btn btn-primary" id="set-up">See plans &amp; redeem a code</button>') +
      '</div>' +

      '<div class="card form-card">' +
        '<div class="card-head"><h2>Danger zone</h2></div>' +
        '<div class="row-gap">' +
          '<button class="btn btn-danger" id="set-resetprog">Reset progress</button>' +
          '<button class="btn btn-danger" id="set-resetall">Reset everything</button>' +
        '</div>' +
        '<p class="fineprint">Reset progress keeps your premium unlock and settings but clears answers, ratings, and streaks (you\'ll re-onboard). Reset everything wipes the lot.</p>' +
      '</div>' +

      '<p class="fineprint">Summit is an independent study tool, not affiliated with or endorsed by College Board. Questions come from College Board\'s public SAT Suite Question Bank and are their copyrighted content — downloaded to your device for personal study only. All of your data stays in this browser.</p>';

    const dlBtn = $('#set-dl');
    if (dlBtn) dlBtn.onclick = () => {
      const proxy = $('#set-proxy').value.trim();
      s.settings.corsProxy = proxy;
      SMStore.save();
      startDownload();
    };
    const clearBtn = $('#set-clearbank');
    if (clearBtn) clearBtn.onclick = async () => {
      if (!confirm('Delete the downloaded question bank from this browser?')) return;
      await SMBank.clearDownloaded();
      bank = await SMBank.load(true);
      render();
    };
    $('#set-proxy').onchange = () => { s.settings.corsProxy = $('#set-proxy').value.trim(); SMStore.save(); };
    $('#set-focus').onchange = () => { s.settings.focus = $('#set-focus').value; SMStore.save(); };
    const upBtn = $('#set-up');
    if (upBtn) upBtn.onclick = openUpgrade;
    const unBtn = $('#set-unpremium');
    if (unBtn) unBtn.onclick = () => {
      if (!confirm('Deactivate premium on this device?')) return;
      s.premium = { active: false, code: null, since: null };
      SMStore.save();
      render();
    };
    $('#set-resetprog').onclick = () => {
      if (!confirm('Clear all answers, ratings, and streaks?')) return;
      SMStore.resetProgress();
      practice = { phase: 'idle' }; mock = null; tab = 'practice';
      render();
    };
    $('#set-resetall').onclick = () => {
      if (!confirm('Wipe ALL Summit data on this device?')) return;
      SMStore.reset();
      practice = { phase: 'idle' }; mock = null; tab = 'practice';
      render();
    };
  }

  /* ============================== boot ============================= */

  (async function boot() {
    bank = await SMBank.load();
    render();
  })();
})();
