---
name: verify
description: How to run and verify the apps in this repo (Lumen at root, tradebot/, scanner/, scalper/).
---

# Verifying this repo

All four apps are no-build static sites: vanilla HTML/CSS/JS, state in
localStorage, IIFE modules loaded via script tags.

## Serve

```bash
python3 -m http.server 8899   # from the repo root
```

- Lumen: `http://localhost:8899/`
- MFFU Trade Copilot: `http://localhost:8899/tradebot/?mock=1`
- Scout scanner: `http://localhost:8899/scanner/?mock=1`
- Pulse scalper sim: `http://localhost:8899/scalper/?mock=1`

`?mock=1` makes tradebot and scanner run fully offline with canned data —
no API keys, no network. For scalper (which is always offline) it pins
seed 42 + the rug-pull scenario so a run is deterministic. Use it for all
UI verification; real market/AI calls are blocked from the sandbox anyway.

## Drive

Playwright 1.56 is installed globally; Chromium is preinstalled
(PLAYWRIGHT_BROWSERS_PATH is set). In a node script:

```js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
```

Use a 420×860 viewport (these are phone-first apps). localStorage is fresh
per browser context, so each run starts at onboarding — click through it
first. Scout flow worth driving: onboard → Scan now → check `.cand` cards →
`#ai-go` → star → Watchlist tab → `#wl-refresh` → Settings save → reload
(state must persist). Pulse flow: onboard → click the 4× speed chip →
`#r-go` → wait for `#res-again` (~7 s) → `#lv-banner` must contain
"LIQUIDITY" (mock = rug seed) → History tab shows a `.trade-row` with
smart vs timer PnL → Settings: edit a `.st-exit` input, `#st-save`, reload
(value must persist). Watch `page.on('console'/'pageerror')` — the apps
should log zero errors.

## Unit tests

The scanner and the scalper have node tests (pure engines, no DOM):

```bash
node --test scanner/test/scanner.test.js   # note: `scanner/test/` with trailing slash fails
node --test scalper/test/sim.test.js scalper/test/exit.test.js scalper/test/trader.test.js
```
