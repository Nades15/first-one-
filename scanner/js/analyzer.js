/* Scout — AI second opinion via the Claude API.
 * Calls the API directly from the browser with the user's own key
 * (never stored anywhere but localStorage on this device). One batched
 * request covers all candidates, so a full pass costs a few cents. */
window.SCAnalyzer = (function () {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';

  const SYSTEM_PROMPT = `You are a careful probability forecaster reviewing prediction-market contracts. For each market you receive, estimate the probability that the stated side resolves YES-for-that-side, independently of the market price. Think like a calibrated superforecaster: base rates first, then adjust for specifics you are confident about.

Be honest about your limits: you cannot browse, and events may have moved after your knowledge cutoff. For anything driven by very recent news, live scores, weather, or fast-moving prices, say so in "caution" and keep your estimate close to the base rate or the market price rather than guessing.

Respond with ONLY a JSON array, no markdown fences, no prose before or after. One object per market, same order as given:
[{
  "id": "<the market's id, copied exactly>",
  "aiProb": <your probability estimate for the stated side, 1-99, integer percent>,
  "reasoning": "<1-2 sentences: the main driver of your estimate>",
  "caution": "<what you cannot know or what could have changed, 1 sentence; empty string if genuinely none>"
}]`;

  /* Pull the first balanced JSON array out of the model's reply. */
  function extractJSONArray(text) {
    const start = text.indexOf('[');
    if (start === -1) throw new Error('No JSON in model response.');
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === '[') depth++;
      if (c === ']' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
    throw new Error('Incomplete JSON in model response.');
  }

  function friendlyError(status, body) {
    if (status === 401) return 'API key rejected (401). Re-check the key in Settings.';
    if (status === 400 && /credit/i.test(body)) return 'Your Anthropic account is out of credits.';
    if (status === 400) return 'The API rejected the request (400): ' + body.slice(0, 200);
    if (status === 429) return 'Rate limited (429) — wait a few seconds and try again.';
    if (status === 529) return 'Anthropic servers are overloaded (529) — try again shortly.';
    return 'API error ' + status + ': ' + body.slice(0, 200);
  }

  /* AGREE within this many percentage points of the market price. */
  const AGREE_MARGIN = 8;

  function verdictFor(aiProb, marketProbPct) {
    const diff = aiProb - marketProbPct;
    if (diff >= AGREE_MARGIN) return 'MARKET_TOO_LOW';    // AI sees higher odds → possible value
    if (diff <= -AGREE_MARGIN) return 'MARKET_TOO_HIGH';  // crowd may be overconfident
    return 'AGREE';
  }

  /*
   * Analyze candidates (from SCScan.findCandidates). Returns a map of
   * candidate.key -> { aiProb, verdict, reasoning, caution }.
   */
  async function analyzeCandidates({ apiKey, model, candidates }) {
    if (!candidates.length) return {};
    if (SCPlatforms.isMock()) {
      await new Promise(r => setTimeout(r, 800));
      const drift = [11, -2, 4, -12, 1, 9, -5];
      const out = {};
      candidates.forEach((c, i) => {
        const marketPct = Math.round(c.prob * 100);
        const aiProb = Math.max(1, Math.min(99, marketPct + drift[i % drift.length]));
        out[c.key] = {
          aiProb, verdict: verdictFor(aiProb, marketPct),
          reasoning: 'Mock estimate for UI testing — base rate plus a nudge.',
          caution: 'Mock data, not a real analysis.',
        };
      });
      return out;
    }
    if (!apiKey) throw new Error('Add your Claude API key in Settings first.');

    const lines = candidates.map(c => ({
      id: c.key,
      platform: c.platform,
      market: c.title,
      side: c.side,
      marketImpliedProb: Math.round(c.prob * 100) + '%',
      resolves: c.closeTime ? new Date(c.closeTime).toUTCString() : 'unknown',
      category: c.category || 'unknown',
    }));
    const userText = 'Today is ' + new Date().toUTCString() + '.\n' +
      'Estimate each of these ' + lines.length + ' prediction-market sides and respond with the JSON array only:\n' +
      JSON.stringify(lines, null, 1);

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
        max_tokens: 250 * candidates.length + 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userText }],
      }),
    });

    const bodyText = await res.text();
    if (!res.ok) throw new Error(friendlyError(res.status, bodyText));
    const data = JSON.parse(bodyText);
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const arr = extractJSONArray(text);

    const byKey = {};
    for (const c of candidates) byKey[c.key] = c;
    const out = {};
    for (const row of arr) {
      const c = row && byKey[row.id];
      if (!c) continue;
      const aiProb = Math.max(1, Math.min(99, Math.round(Number(row.aiProb) || 0)));
      if (!aiProb) continue;
      out[c.key] = {
        aiProb,
        verdict: verdictFor(aiProb, Math.round(c.prob * 100)),
        reasoning: String(row.reasoning || ''),
        caution: String(row.caution || ''),
      };
    }
    if (!Object.keys(out).length) throw new Error('The model\'s response did not match the scanned markets. Try again.');
    return out;
  }

  return { analyzeCandidates, verdictFor, AGREE_MARGIN };
})();
