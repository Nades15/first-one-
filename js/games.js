/* Lumen — daily brain games. Each game renders into a container and reports a 0-100 score. */
window.Games = (function () {
  'use strict';

  /* ---------- helpers ---------- */

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    children.flat().forEach((c) => { if (c != null) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }

  /* Deterministic RNG so a given day always serves the same puzzles. */
  function seededRng(seedStr) {
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = (Math.imul(s, 31) + seedStr.charCodeAt(i)) | 0;
    return function () {
      s = (Math.imul(s ^ (s >>> 15), s | 1)) | 0;
      s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
      return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
  }

  const pickN = (arr, n, rng) => {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  };

  const shuffle = (arr, rng) => pickN(arr, arr.length, rng);

  function diffBucket(diff) {
    return diff <= 2 ? 'easy' : diff === 3 ? 'medium' : 'hard';
  }

  function progressDots(total, current) {
    return h('div', { class: 'dots' },
      Array.from({ length: total }, (_, i) =>
        h('span', { class: 'dot' + (i < current ? ' dot-done' : i === current ? ' dot-cur' : '') })));
  }

  /* Multiple-choice round runner shared by verbal/logic question games. */
  function runQuestionRounds(container, rounds, onDone, opts = {}) {
    let idx = 0, correct = 0;

    function show() {
      if (idx >= rounds.length) return onDone(Math.round((correct / rounds.length) * 100));
      const r = rounds[idx];
      container.replaceChildren(
        progressDots(rounds.length, idx),
        h('p', { class: 'game-q' }, r.q),
        h('div', { class: 'options' },
          r.options.map((opt, i) =>
            h('button', {
              class: 'option-btn',
              onclick: (e) => answer(i, e.target),
            }, opt))),
      );
    }

    function answer(i, btn) {
      const r = rounds[idx];
      const isRight = i === r.answer;
      if (isRight) correct++;
      container.querySelectorAll('.option-btn').forEach((b, bi) => {
        b.disabled = true;
        if (bi === r.answer) b.classList.add('opt-right');
      });
      if (!isRight) btn.classList.add('opt-wrong');
      if (r.why) container.append(h('p', { class: 'why' }, r.why));
      container.append(h('button', { class: 'btn btn-primary next-btn', onclick: () => { idx++; show(); } },
        idx + 1 < rounds.length ? 'Next' : 'Finish'));
    }

    show();
  }

  /* ---------- 1. Pattern Matrix (Raven-style) ---------- */

  const SHAPES = ['circle', 'square', 'triangle', 'diamond'];

  function shapeSVGPart(shape, cx, cy, r, fillMode) {
    const fill = fillMode === 'solid' ? 'currentColor' : fillMode === 'half' ? 'currentColor' : 'none';
    const opacity = fillMode === 'half' ? '0.35' : '1';
    const common = `stroke="currentColor" stroke-width="2.5" fill="${fill}" fill-opacity="${opacity}"`;
    if (shape === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${r}" ${common}/>`;
    if (shape === 'square') return `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" rx="2" ${common}/>`;
    if (shape === 'triangle') return `<polygon points="${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}" ${common}/>`;
    return `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" ${common}/>`; // diamond
  }

  function cellSVG(cell) {
    const { count, shape, fillMode } = cell;
    const W = 84, r = count === 1 ? 16 : 10;
    const xs = count === 1 ? [W / 2] : count === 2 ? [W / 3, (2 * W) / 3] : [W / 5, W / 2, (4 * W) / 5];
    const parts = xs.map((x) => shapeSVGPart(shape, x, W / 2, r, fillMode)).join('');
    const svg = h('div', { class: 'matrix-cell-inner' });
    svg.innerHTML = `<svg viewBox="0 0 ${W} ${W}" aria-hidden="true">${parts}</svg>`;
    return svg;
  }

  function genMatrixPuzzle(diff, rng) {
    const shapeOrder = pickN(SHAPES, 3, rng);
    const fillModes = shuffle(['solid', 'half', 'outline'], rng);
    const countByCol = shuffle([1, 2, 3], rng);
    // Easy: shape varies by row, count by column, fill constant.
    // Harder: fill also varies (by column at diff 3-4, by row at 5).
    const fillVaries = diff >= 3;
    const fillAxis = diff >= 5 ? 'row' : 'col';

    const cell = (r, c) => ({
      shape: shapeOrder[r],
      count: countByCol[c],
      fillMode: fillVaries ? fillModes[fillAxis === 'col' ? c : r] : 'solid',
    });

    const grid = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push(cell(r, c));
    const answer = grid[8];

    const mutants = [
      { ...answer, count: (answer.count % 3) + 1 },
      { ...answer, shape: SHAPES.find((s) => s !== answer.shape) },
      fillVaries
        ? { ...answer, fillMode: fillModes.find((f) => f !== answer.fillMode) }
        : { ...answer, count: ((answer.count + 1) % 3) + 1, shape: shapeOrder[(shapeOrder.indexOf(answer.shape) + 1) % 3] },
    ];
    const options = shuffle([answer, ...mutants], rng);
    return { grid, options, answerIdx: options.indexOf(answer) };
  }

  function startMatrix(container, diff, onDone, rng) {
    const total = 3;
    let idx = 0, correct = 0;

    function show() {
      if (idx >= total) return onDone(Math.round((correct / total) * 100));
      const p = genMatrixPuzzle(diff, rng);
      const gridEl = h('div', { class: 'matrix-grid' },
        p.grid.map((cell, i) =>
          h('div', { class: 'matrix-cell' + (i === 8 ? ' matrix-missing' : '') },
            i === 8 ? h('span', { class: 'matrix-q' }, '?') : cellSVG(cell))));
      const optsEl = h('div', { class: 'matrix-options' },
        p.options.map((cell, i) =>
          h('button', { class: 'matrix-opt', onclick: (e) => pick(i, p, e.currentTarget) }, cellSVG(cell))));
      container.replaceChildren(
        progressDots(total, idx),
        h('p', { class: 'game-hint' }, 'Which tile completes the pattern?'),
        gridEl, optsEl,
      );
    }

    function pick(i, p, btn) {
      const right = i === p.answerIdx;
      if (right) correct++;
      container.querySelectorAll('.matrix-opt').forEach((b, bi) => {
        b.disabled = true;
        if (bi === p.answerIdx) b.classList.add('opt-right');
      });
      if (!right) btn.classList.add('opt-wrong');
      container.append(h('button', { class: 'btn btn-primary next-btn', onclick: () => { idx++; show(); } },
        idx + 1 < total ? 'Next' : 'Finish'));
    }

    show();
  }

  /* ---------- 2. Number Sequence ---------- */

  function genSequence(diff, rng) {
    const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    const kind = diff <= 1 ? 0 : diff === 2 ? ri(0, 1) : diff === 3 ? ri(1, 2) : diff === 4 ? ri(2, 3) : ri(3, 4);
    let seq = [], rule = '';
    if (kind === 0) {              // arithmetic
      const start = ri(1, 12), step = ri(2, 9);
      seq = Array.from({ length: 5 }, (_, i) => start + i * step);
      rule = `Each term adds ${step}.`;
    } else if (kind === 1) {       // geometric ×2 or ×3
      const start = ri(1, 5), mult = ri(2, 3);
      seq = Array.from({ length: 5 }, (_, i) => start * mult ** i);
      rule = `Each term is multiplied by ${mult}.`;
    } else if (kind === 2) {       // growing differences (+a, +a+d, +a+2d…)
      const start = ri(1, 9), a = ri(2, 5), d = ri(1, 4);
      seq = [start];
      for (let i = 0; i < 4; i++) seq.push(seq[seq.length - 1] + a + i * d);
      rule = `The gaps grow by ${d} each step (+${a}, +${a + d}, +${a + 2 * d}…).`;
    } else if (kind === 3) {       // fibonacci-like
      let a = ri(1, 4), b = ri(2, 6);
      seq = [a, b];
      for (let i = 0; i < 3; i++) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
      rule = 'Each term is the sum of the previous two.';
    } else {                       // ×2 minus/plus k
      const k = ri(1, 3), start = ri(2, 5);
      seq = [start];
      for (let i = 0; i < 4; i++) seq.push(seq[seq.length - 1] * 2 - k);
      rule = `Each term is double the previous, minus ${k}.`;
    }
    const next = kind === 0 ? seq[4] + (seq[1] - seq[0])
      : kind === 1 ? seq[4] * (seq[1] / seq[0])
      : kind === 2 ? seq[4] + (seq[4] - seq[3]) + (seq[4] - seq[3] - (seq[3] - seq[2]))
      : kind === 3 ? seq[4] + seq[3]
      : seq[4] * 2 - (seq[3] * 2 - seq[4]);
    return { shown: seq, next, rule };
  }

  function startSequence(container, diff, onDone, rng) {
    const total = 4;
    let idx = 0, correct = 0;

    function show() {
      if (idx >= total) return onDone(Math.round((correct / total) * 100));
      const p = genSequence(diff, rng);
      const input = h('input', { class: 'num-input', type: 'number', inputmode: 'numeric', placeholder: '?', autocomplete: 'off' });
      const form = h('form', { class: 'seq-form', onsubmit: (e) => { e.preventDefault(); check(); } },
        input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Check'));
      container.replaceChildren(
        progressDots(total, idx),
        h('p', { class: 'game-hint' }, 'What number comes next?'),
        h('div', { class: 'seq-row' }, p.shown.map((n) => h('span', { class: 'seq-num' }, String(n))), h('span', { class: 'seq-num seq-blank' }, '?')),
        form,
      );
      input.focus();

      function check() {
        if (input.value === '') return;
        const right = Number(input.value) === p.next;
        if (right) correct++;
        input.disabled = true;
        form.querySelector('button').remove();
        container.append(
          h('p', { class: right ? 'why why-right' : 'why why-wrong' },
            (right ? 'Correct! ' : `The answer was ${p.next}. `) + p.rule),
          h('button', { class: 'btn btn-primary next-btn', onclick: () => { idx++; show(); } },
            idx + 1 < total ? 'Next' : 'Finish'),
        );
      }
    }

    show();
  }

  /* ---------- 3. Memory Grid ---------- */

  function startMemGrid(container, diff, onDone, rng) {
    const total = 3;
    const size = diff <= 2 ? 4 : 5;
    const k = 3 + diff;
    let round = 0;
    const roundScores = [];

    function show() {
      if (round >= total) return onDone(Math.round(window.Scoring.mean(roundScores)));
      const cells = size * size;
      const lit = new Set(pickN(Array.from({ length: cells }, (_, i) => i), Math.min(k, cells - 2), rng));
      let picks = new Set(), phase = 'watch';

      const gridEl = h('div', { class: 'mem-grid', style: `grid-template-columns:repeat(${size},1fr)` },
        Array.from({ length: cells }, (_, i) =>
          h('button', { class: 'mem-cell', 'data-i': i, onclick: () => tap(i) })));
      const status = h('p', { class: 'game-hint' }, 'Memorise the highlighted tiles…');
      container.replaceChildren(progressDots(total, round), status, gridEl);

      const cellEls = [...gridEl.children];
      lit.forEach((i) => cellEls[i].classList.add('mem-lit'));

      setTimeout(() => {
        lit.forEach((i) => cellEls[i].classList.remove('mem-lit'));
        phase = 'recall';
        status.textContent = `Tap the ${lit.size} tiles that were highlighted.`;
      }, 1400 + diff * 150);

      function tap(i) {
        if (phase !== 'recall' || picks.has(i)) return;
        picks.add(i);
        cellEls[i].classList.add(lit.has(i) ? 'mem-hit' : 'mem-miss');
        if (picks.size >= lit.size) finishRound();
      }

      function finishRound() {
        phase = 'done';
        const hits = [...picks].filter((i) => lit.has(i)).length;
        lit.forEach((i) => { if (!picks.has(i)) cellEls[i].classList.add('mem-lit'); });
        roundScores.push(Math.round((hits / lit.size) * 100));
        status.textContent = `${hits} of ${lit.size} — ${hits === lit.size ? 'perfect!' : 'the missed tiles are shown.'}`;
        container.append(h('button', { class: 'btn btn-primary next-btn', onclick: () => { round++; show(); } },
          round + 1 < total ? 'Next round' : 'Finish'));
      }
    }

    show();
  }

  /* ---------- 4. Digit Span ---------- */

  function startDigitSpan(container, diff, onDone, rng) {
    const total = 3;
    const reversed = diff >= 4;
    let round = 0;
    const roundScores = [];

    function show() {
      if (round >= total) return onDone(Math.round(window.Scoring.mean(roundScores)));
      const len = 3 + diff + round; // grows within the session
      const digits = Array.from({ length: len }, () => Math.floor(rng() * 10));
      const target = (reversed ? digits.slice().reverse() : digits).join('');

      const display = h('div', { class: 'digit-display' }, '');
      const status = h('p', { class: 'game-hint' }, reversed ? 'Watch — you\'ll type them in REVERSE order.' : 'Watch the digits…');
      container.replaceChildren(progressDots(total, round), status, display);

      let i = 0;
      const iv = setInterval(() => {
        if (i < digits.length) {
          display.textContent = String(digits[i]);
          display.classList.remove('digit-pop');
          void display.offsetWidth; // restart the pop animation
          display.classList.add('digit-pop');
          i++;
        } else {
          clearInterval(iv);
          askRecall();
        }
      }, 750);

      function askRecall() {
        display.textContent = '';
        status.textContent = reversed ? 'Type the digits in reverse order.' : 'Type the digits in order.';
        const input = h('input', { class: 'num-input digit-input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off' });
        const form = h('form', { class: 'seq-form', onsubmit: (e) => { e.preventDefault(); check(); } },
          input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Check'));
        container.append(form);
        input.focus();

        function check() {
          const val = input.value.replace(/\D/g, '');
          if (!val) return;
          let prefix = 0;
          while (prefix < target.length && val[prefix] === target[prefix]) prefix++;
          const score = val === target ? 100 : Math.round((prefix / target.length) * 70);
          roundScores.push(score);
          input.disabled = true;
          form.querySelector('button').remove();
          container.append(
            h('p', { class: score === 100 ? 'why why-right' : 'why why-wrong' },
              score === 100 ? 'Perfect recall!' : `It was ${target}.`),
            h('button', { class: 'btn btn-primary next-btn', onclick: () => { round++; show(); } },
              round + 1 < total ? 'Next round' : 'Finish'),
          );
        }
      }
    }

    show();
  }

  /* ---------- 5-7. Bank-driven question games ---------- */

  function startAnalogy(container, diff, onDone, rng) {
    const bank = window.DATA.analogies[diffBucket(diff)];
    const rounds = pickN(bank, Math.min(5, bank.length), rng)
      .map((item) => ({ q: item.q, options: item.options, answer: item.answer }));
    runQuestionRounds(container, rounds, onDone);
  }

  function startOddOne(container, diff, onDone, rng) {
    const bank = window.DATA.oddOneOut[diffBucket(diff)];
    const rounds = pickN(bank, Math.min(5, bank.length), rng)
      .map((item) => ({ q: 'Which one does not belong?', options: item.options, answer: item.answer, why: item.why }));
    runQuestionRounds(container, rounds, onDone);
  }

  function startSyllogism(container, diff, onDone, rng) {
    const bank = window.DATA.syllogisms[diffBucket(diff)];
    const rounds = pickN(bank, Math.min(5, bank.length), rng)
      .map((item) => ({ q: item.q, options: ['Follows logically', 'Does not follow'], answer: item.answer, why: item.why }));
    runQuestionRounds(container, rounds, onDone);
  }

  /* ---------- 8. Math Sprint ---------- */

  function genProblem(diff, rng) {
    const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
    if (diff <= 1) { const a = ri(3, 20), b = ri(3, 20); return { q: `${a} + ${b}`, a: a + b }; }
    if (diff === 2) {
      if (rng() < 0.5) { const a = ri(10, 40), b = ri(3, a - 1); return { q: `${a} − ${b}`, a: a - b }; }
      const a = ri(3, 9), b = ri(3, 9); return { q: `${a} × ${b}`, a: a * b };
    }
    if (diff === 3) {
      if (rng() < 0.5) { const a = ri(4, 12), b = ri(4, 12); return { q: `${a} × ${b}`, a: a * b }; }
      const b = ri(3, 9), c = ri(2, 9), a = b * c; return { q: `${a} ÷ ${b}`, a: c };
    }
    if (diff === 4) { const a = ri(3, 9), b = ri(3, 9), c = ri(5, 30); return { q: `${a} × ${b} + ${c}`, a: a * b + c }; }
    const pcts = [10, 20, 25, 50];
    if (rng() < 0.5) { const p = pcts[ri(0, 3)], n = ri(2, 20) * 20; return { q: `${p}% of ${n}`, a: (p / 100) * n }; }
    const a = ri(11, 19), b = ri(11, 19); return { q: `${a} × ${b}`, a: a * b };
  }

  function startMathSprint(container, diff, onDone, rng) {
    const DURATION = 45;
    const target = 8 + diff * 2;
    let correct = 0, attempted = 0, timeLeft = DURATION, current = null;

    const timerEl = h('span', { class: 'sprint-timer' }, `${DURATION}s`);
    const scoreEl = h('span', { class: 'sprint-score' }, 'Solved: 0');
    const qEl = h('div', { class: 'sprint-q' }, '');
    const input = h('input', { class: 'num-input', type: 'number', inputmode: 'numeric', autocomplete: 'off', placeholder: 'answer' });
    const form = h('form', { class: 'seq-form', onsubmit: (e) => { e.preventDefault(); submit(); } },
      input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Go'));

    container.replaceChildren(
      h('div', { class: 'sprint-bar' }, timerEl, scoreEl),
      h('p', { class: 'game-hint' }, `Solve as many as you can in ${DURATION} seconds.`),
      qEl, form,
    );

    function next() { current = genProblem(diff, rng); qEl.textContent = current.q + ' = ?'; input.value = ''; input.focus(); }
    function submit() {
      if (input.value === '') return;
      attempted++;
      if (Number(input.value) === current.a) { correct++; qEl.classList.remove('flash-bad'); }
      else { qEl.classList.add('flash-bad'); setTimeout(() => qEl.classList.remove('flash-bad'), 350); }
      scoreEl.textContent = `Solved: ${correct}`;
      next();
    }

    const iv = setInterval(() => {
      timeLeft--;
      timerEl.textContent = `${timeLeft}s`;
      if (timeLeft <= 0) {
        clearInterval(iv);
        const accuracy = attempted ? correct / attempted : 0;
        const score = Math.min(100, Math.round((correct / target) * 85 + accuracy * 15));
        container.replaceChildren(
          h('p', { class: 'game-hint' }, `Time! You solved ${correct} of ${attempted} attempted.`),
          h('button', { class: 'btn btn-primary', onclick: () => onDone(score) }, 'Finish'),
        );
      }
    }, 1000);

    next();
  }

  /* ---------- registry ---------- */

  const registry = {
    matrix:     { id: 'matrix',     name: 'Pattern Matrix', domain: 'logic',  icon: '🧩', blurb: 'Find the tile that completes the pattern.', start: startMatrix },
    sequence:   { id: 'sequence',   name: 'Number Flow',    domain: 'logic',  icon: '🔢', blurb: 'Spot the rule, predict the next number.',   start: startSequence },
    syllogism:  { id: 'syllogism',  name: 'Logic Court',    domain: 'logic',  icon: '⚖️', blurb: 'Does the conclusion actually follow?',      start: startSyllogism },
    memgrid:    { id: 'memgrid',    name: 'Photo Memory',   domain: 'memory', icon: '📸', blurb: 'Memorise the tiles, then find them again.', start: startMemGrid },
    digitspan:  { id: 'digitspan',  name: 'Digit Echo',     domain: 'memory', icon: '🎧', blurb: 'Hold a growing string of digits in mind.',  start: startDigitSpan },
    analogy:    { id: 'analogy',    name: 'Word Bridges',   domain: 'verbal', icon: '🌉', blurb: 'Complete the relationship between words.',  start: startAnalogy },
    oddone:     { id: 'oddone',     name: 'Odd One Out',    domain: 'verbal', icon: '🕵️', blurb: 'One of these things is not like the others.', start: startOddOne },
    mathsprint: { id: 'mathsprint', name: 'Math Sprint',    domain: 'speed',  icon: '⚡', blurb: '45 seconds of rapid mental arithmetic.',     start: startMathSprint },
  };

  /* Today's circuit: one logic, one memory, and verbal/speed on alternate days. */
  function circuitFor(dateISO) {
    const idx = window.Store.daysSinceEpoch(dateISO);
    const logic = ['matrix', 'sequence', 'syllogism'][idx % 3];
    const memory = ['memgrid', 'digitspan'][idx % 2];
    const third = idx % 2 === 1 ? 'mathsprint' : ['analogy', 'oddone'][Math.floor(idx / 2) % 2];
    return [logic, memory, third];
  }

  function play(gameId, container, onDone) {
    const state = window.Store.load();
    const game = registry[gameId];
    const diff = state.difficulty[game.domain] || 2;
    const rng = seededRng(window.Store.todayISO() + ':' + gameId);
    game.start(container, diff, (score) => onDone(score, game, diff), rng);
  }

  return { registry, circuitFor, play, h, seededRng, pickN, shuffle };
})();
