# 🎯 Scout — prediction market scanner

An on-demand scanner for **Polymarket** and **Kalshi**. One tap sweeps thousands of
live markets and surfaces the bets the crowd prices around **75% to hit** — filtered
by volume, resolution date, and keyword — then (optionally) asks Claude for an
independent probability on each one and flags the prices it disagrees with.

## What it does

- **🔍 Scan** — pulls both platforms' free public market APIs (no account, no key)
  and keeps whatever lands in your probability band (default **70–80%**). It checks
  *both sides* of every market: a NO priced 75% is a YES trading at 25¢, and Scout
  finds it either way. Results are ranked by closeness to the band center, 24-hour
  volume, and how soon the market resolves; each card links straight to the live
  market.
- **🤖 AI second opinion** — with your Claude API key, one batched call has the model
  estimate each top candidate's probability independently of the price. Cards get a
  verdict: **💎 possible value** (AI sees higher odds than the price), **⚠ AI sees
  lower odds**, or **✓ agrees with the market** — with the reasoning and an explicit
  caution about what the model can't know.
- **⭐ Watchlist** — star candidates to track them; Scout remembers the price you
  saved them at, and a refresh button re-quotes just those markets and shows the
  drift in points.
- **Scan controls** — platform toggles, band edges, minimum 24h volume, resolves-within
  window (24h → 30d → any), keyword filter, and a Quick / Standard / Deep depth that
  decides how many thousand markets get swept.

## Setup (1 minute)

1. Open the app (GitHub Pages: `https://<user>.github.io/<repo>/scanner/`) — or locally:
   serve the repo (`python3 -m http.server`) and open `/scanner/`.
2. That's it for scanning — the market data is public. For AI second opinions, add a
   Claude API key from [console.anthropic.com](https://console.anthropic.com) in
   Settings (a pass over 10 markets costs a few cents).
3. On a phone, use "Add to Home Screen" to install it like an app.

Your API key and all data stay in your browser's `localStorage`. Network calls go
only to `gamma-api.polymarket.com`, Kalshi's public API, and (for AI passes)
`api.anthropic.com`. If a platform ever blocks browser calls, the same request is
retried automatically through the CORS proxy configured in Settings.

## Honest expectations — read this

A prediction-market price **is** a probability: a 75¢ contract that truly hits 75%
of the time returns exactly what it costs, before fees. Scanning for the 75% zone
does not, by itself, find profitable bets — it finds **liquid, near-term,
high-probability markets worth a closer look**. Real edge, when it exists, comes
from spotting prices the crowd got wrong.

That's what the AI pass is for — but treat it as one more opinion, not an oracle.
The model can't browse; anything driven by breaking news, injuries, weather, or live
prices may have moved after its knowledge cutoff, and Scout makes it say so in each
card's caution. Prices also move between the scan and your click — always confirm on
the platform. Nothing here is financial advice; every bet is your decision and your
responsibility.

## Project layout

```
index.html            app shell
manifest.webmanifest  installable-app metadata
css/style.css         styles (light + dark)
js/config.js          endpoints, filter defaults, model list
js/storage.js         localStorage state
js/scanner.js         pure scan engine: normalize / band-pick / filter / rank (node-testable)
js/platforms.js       Polymarket + Kalshi fetch clients with CORS-proxy fallback
js/analyzer.js        batched Claude probability estimates + verdicts
js/app.js             screens & wiring
test/scanner.test.js  engine tests — node --test scanner/test/scanner.test.js
```

Append `?mock=1` to the URL to exercise the whole UI (scan, AI pass, watchlist) with
canned data — no network or API key needed.
