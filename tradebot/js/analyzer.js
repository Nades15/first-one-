/* MFFU Trade Copilot — chart analysis via the Claude API.
 * Calls the API directly from the browser with the user's own key
 * (never stored anywhere but localStorage on this device).
 * UMD wrapper so validation logic is unit-testable in node
 * (the DOM-dependent image prep is guarded).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBAnalyzer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MAX_EDGE = 1568; // Claude vision sweet spot — larger is resized anyway
  const MIN_RR = 1.2;    // signals with TP1 below this R:R are downgraded to NO_TRADE
  const MAX_CHARTS = 3;

  const SYSTEM_PROMPT = `You are a disciplined futures trading analyst helping a trader pass a MyFundedFutures prop-firm evaluation. You will be shown one to three chart screenshots of the same instrument. Your #1 priority is capital preservation: the trader is destroyed by drawdown breaches, not by missed trades. When the picture is unclear, mixed, mid-range, or missing key information, answer NO_TRADE. A good evaluation is passed with a few clean, obvious setups — not by forcing trades.

If multiple charts are provided, they are labeled with their timeframes: do top-down analysis. Establish directional bias on the higher timeframe, and only signal a trade when the lower (entry) timeframe shows a trigger IN THE SAME DIRECTION as that bias. If the timeframes disagree, answer NO_TRADE and say which one is fighting the other.

Respect the trader's declared timeframe and style: stop and target distances must be proportionate to that timeframe (a scalp does not use a swing-sized stop, and a swing idea should not be judged off one candle). If the chart's visible timeframe contradicts what the trader declared, point it out and lean NO_TRADE. If a session clock is visible, factor in the time of day (opening drive vs lunch chop vs close).

Analyze only what is visible: trend structure, support/resistance, candlestick behavior, any indicators shown, volume if visible. You cannot see order flow, news, or timeframes not pictured — say so when it matters. Consider both the continuation case and the reversal case; if they are evenly matched, that is a NO_TRADE.

Respond with ONLY a JSON object, no markdown fences, no prose before or after:
{
  "signal": "LONG" | "SHORT" | "NO_TRADE",
  "confidence": <0-100, be honest; below 60 should be NO_TRADE>,
  "timeframe": "<entry chart timeframe if visible, else 'unknown'>",
  "entry": <suggested entry price, or null>,
  "stopLoss": <price where the idea is wrong, or null>,
  "tp1": <first target price, or null>,
  "tp2": <second target price, or null>,
  "rationale": "<2-4 sentences: the setup and why; mention the higher-timeframe bias if multiple charts>",
  "invalidation": "<what would make this trade wrong before entry>",
  "risks": "<what you cannot see or what could go wrong>"
}

Rules for prices: read the price axis carefully. Stop losses go beyond structure (swing high/low), not at arbitrary distances. TP1 must offer at least 1.5R (reward at least 1.5x the entry-to-stop distance) or the trade is not worth taking — answer NO_TRADE instead. TP2 is an extended target. For NO_TRADE, set entry/stopLoss/tp1/tp2 to null and explain what you'd need to see. Never invent price levels you cannot justify from the image.`;

  /* Downscale + JPEG-encode an image File/Blob for the API. Browser-only. */
  function prepareImage(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', dataUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
      img.src = url;
    });
  }

  /* Pull the first balanced JSON object out of the model's reply. */
  function extractJSON(text) {
    const start = text.indexOf('{');
    if (start === -1) throw new Error('No JSON in model response.');
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
    throw new Error('Incomplete JSON in model response.');
  }

  /* Reward:risk to TP1, or null when prices are missing. */
  function rewardRisk(s) {
    if (s.entry === null || s.stopLoss === null || s.tp1 === null) return null;
    const risk = Math.abs(s.entry - s.stopLoss);
    return risk > 0 ? Math.abs(s.tp1 - s.entry) / risk : null;
  }

  function validateSignal(s) {
    if (!s || !['LONG', 'SHORT', 'NO_TRADE'].includes(s.signal)) {
      throw new Error('Model returned an unrecognized signal.');
    }
    s.confidence = Math.max(0, Math.min(100, Number(s.confidence) || 0));
    for (const k of ['entry', 'stopLoss', 'tp1', 'tp2']) {
      s[k] = (s[k] === null || s[k] === undefined || s[k] === '') ? null : Number(s[k]);
      if (s[k] !== null && !isFinite(s[k])) s[k] = null;
    }
    if (s.signal !== 'NO_TRADE' && (s.entry === null || s.stopLoss === null)) {
      s.signal = 'NO_TRADE';
      s.risks = (s.risks || '') + ' (Downgraded to NO_TRADE: the model did not provide both an entry and a stop.)';
    }
    // A long's stop must be below entry; a short's above. Otherwise don't trust the read.
    if (s.signal === 'LONG' && s.stopLoss >= s.entry) s.signal = 'NO_TRADE';
    if (s.signal === 'SHORT' && s.stopLoss <= s.entry) s.signal = 'NO_TRADE';
    if (s.signal !== 'NO_TRADE') {
      const rr = rewardRisk(s);
      s.rr = rr;
      if (rr !== null && rr < MIN_RR) {
        s.signal = 'NO_TRADE';
        s.risks = (s.risks || '') + ' (Downgraded to NO_TRADE: TP1 offers only ' + rr.toFixed(1) + 'R — under the ' + MIN_RR + 'R floor, the math loses even with a decent win rate.)';
      }
    }
    return s;
  }

  function friendlyError(status, body) {
    if (status === 401) return 'API key rejected (401). Re-check the key in Settings.';
    if (status === 400 && /credit/i.test(body)) return 'Your Anthropic account is out of credits.';
    if (status === 400) return 'The API rejected the request (400): ' + body.slice(0, 200);
    if (status === 429) return 'Rate limited (429) — wait a few seconds and try again.';
    if (status === 529) return 'Anthropic servers are overloaded (529) — try again shortly.';
    return 'API error ' + status + ': ' + body.slice(0, 200);
  }

  const MOCK_RESPONSE = {
    signal: 'LONG', confidence: 72, timeframe: '5m',
    entry: 21450.25, stopLoss: 21418.0, tp1: 21502.0, tp2: 21545.0,
    rationale: 'Mock response for UI testing: pullback to prior resistance turned support with two rejection wicks and rising volume.',
    invalidation: 'A 5m close below 21420 before entry.',
    risks: 'Mock data — not a real analysis.',
  };

  /*
   * Analyze one or more charts of the same instrument.
   * charts: [{ blob, timeframe }] (max 3) — when more than one, order them
   * however; the labels tell the model which is which.
   * declaredTimeframe/style: the trader's entry timeframe and trading style.
   * accountContext: prose describing plan state so the model can lean
   * NO_TRADE when the account cannot afford a loss.
   */
  async function analyze({ apiKey, model, charts, instrument, declaredTimeframe, style, accountContext }) {
    if (new URLSearchParams(location.search).get('mock') === '1' || window.__TB_MOCK__) {
      await new Promise(r => setTimeout(r, 600));
      return validateSignal(JSON.parse(JSON.stringify(window.__TB_MOCK_SIGNAL__ || MOCK_RESPONSE)));
    }
    if (!apiKey) throw new Error('Add your Claude API key in Settings first.');
    const list = (charts || []).slice(0, MAX_CHARTS);
    if (!list.length) throw new Error('Add a chart screenshot first.');

    const content = [];
    for (let i = 0; i < list.length; i++) {
      const img = await prepareImage(list[i].blob);
      if (list.length > 1) {
        content.push({ type: 'text', text: 'Chart ' + (i + 1) + ' of ' + list.length + ' — trader tagged it as timeframe: ' + (list[i].timeframe || 'untagged') + '.' });
      }
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
    }
    content.push({
      type: 'text',
      text: 'Instrument: ' + instrument.symbol + ' (' + instrument.label + '), tick size ' + instrument.tickSize +
        ', $' + instrument.tickValue.toFixed(2) + ' per tick per contract.\n' +
        'Trader\'s entry timeframe: ' + (declaredTimeframe || 'not sure') + '. Trading style: ' + (style || 'day trade') + '.\n' +
        'Account context: ' + accountContext + '\n' +
        'Analyze and respond with the JSON object only.',
    });

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) throw new Error(friendlyError(res.status, bodyText));
    const data = JSON.parse(bodyText);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return validateSignal(extractJSON(text));
  }

  return { analyze, prepareImage, validateSignal, extractJSON, rewardRisk, MIN_RR, MAX_CHARTS };
});
