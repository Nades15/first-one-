/* Lumen — journal analysis: vocabulary richness, insight markers, emotional granularity. */
window.Journal = (function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function tokenize(text) {
    return (text.toLowerCase().match(/[a-z']+/g) || []).map((w) => w.replace(/^'+|'+$/g, '')).filter(Boolean);
  }

  /* Match a token against a word list, tolerating simple plural/verb endings. */
  function matches(token, wordSet) {
    if (wordSet.has(token)) return true;
    if (token.length > 4 && token.endsWith('s') && wordSet.has(token.slice(0, -1))) return true;
    if (token.length > 5 && token.endsWith('ed') && wordSet.has(token.slice(0, -2))) return true;
    if (token.length > 6 && token.endsWith('ing') && wordSet.has(token.slice(0, -3))) return true;
    return false;
  }

  function countPhraseHits(lowerText, phrases) {
    let hits = 0;
    phrases.forEach((p) => { if (lowerText.includes(p)) hits += 1; });
    return hits;
  }

  function analyze(text) {
    const D = window.DATA;
    const lower = ' ' + text.toLowerCase() + ' ';
    const tokens = tokenize(text);
    const wordCount = tokens.length;
    const uniqueRatio = wordCount ? new Set(tokens).size / wordCount : 0;

    const advSet = new Set(D.advancedVocab);
    const emoSet = new Set(D.emotionVocab);
    const advancedWords = [...new Set(tokens.filter((t) => matches(t, advSet)))];
    const emotionWords = [...new Set(tokens.filter((t) => matches(t, emoSet)))];

    const insightHits = D.insightMarkers.reduce((n, m) => n + (m.includes(' ') ? (lower.includes(m) ? 1 : 0) : (tokens.includes(m) ? 1 : 0)), 0);
    const perspectiveHits = countPhraseHits(lower, D.perspectiveMarkers);

    // Sentence-length variety rewards a mix of short and long sentences.
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 2);
    const lens = sentences.map((s) => s.split(/\s+/).length);
    const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const variety = lens.length > 1
      ? Math.sqrt(lens.reduce((a, l) => a + (l - avgLen) ** 2, 0) / lens.length)
      : 0;

    const lengthScore = clamp((wordCount / 100) * 30, 0, 30);

    const iqComponent = Math.round(clamp(
      lengthScore +
      uniqueRatio * 20 +
      Math.min(advancedWords.length * 8, 25) +
      Math.min(insightHits * 5, 20) +
      Math.min(variety * 1.2, 8),
      0, 100
    ));

    const eqComponent = Math.round(clamp(
      lengthScore * 0.6 +
      Math.min(emotionWords.length * 11, 44) +
      Math.min(perspectiveHits * 14, 28) +
      Math.min(insightHits * 3, 12),
      0, 100
    ));

    const feedback = [];
    if (wordCount < 30) feedback.push('A few more sentences would give your thoughts room to breathe — aim for 40+ words.');
    if (advancedWords.length) feedback.push('Rich vocabulary spotted: ' + advancedWords.slice(0, 5).join(', ') + '.');
    else if (wordCount >= 30) feedback.push('Try reaching for a more precise word or two — precision of language sharpens precision of thought.');
    if (emotionWords.length >= 2) feedback.push('Nice emotional granularity — naming feelings specifically (' + emotionWords.slice(0, 4).join(', ') + ') builds self-awareness.');
    else feedback.push('Try naming what you felt with a specific word — "uneasy" or "hopeful" says more than "good" or "bad".');
    if (perspectiveHits) feedback.push('You considered another person\'s point of view — that\'s the heart of emotional intelligence.');
    if (insightHits >= 3) feedback.push('Strong reflective thinking — you\'re connecting causes, questioning assumptions, drawing conclusions.');
    else if (wordCount >= 30) feedback.push('Push one step deeper: ask yourself "why?" or "what does this mean?" about something you wrote.');

    return { wordCount, uniqueRatio: Math.round(uniqueRatio * 100) / 100, advancedWords, emotionWords, insightHits, perspectiveHits, iqComponent, eqComponent, feedback };
  }

  function promptForDate(dateISO) {
    const idx = window.Store.daysSinceEpoch(dateISO) % window.DATA.journalPrompts.length;
    return window.DATA.journalPrompts[idx];
  }

  return { analyze, promptForDate };
})();
