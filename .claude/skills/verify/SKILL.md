---
name: verify
description: How to run and verify the apps in this repo (Lumen at root, tradebot/, scanner/, scalper/, the livebot/ Node sniper, and the backtest/ Python research project).
---

# Verifying this repo

The first four apps (Lumen, tradebot, scanner, scalper) are no-build static
sites: vanilla HTML/CSS/JS, state in localStorage, IIFE modules loaded via
script tags. `livebot/` is different — a Node.js process (CommonJS) that reuses
`scalper/js/exit.js` as its exit engine; see its own section below.

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

The scanner, scalper, and livebot have node tests (pure logic, no DOM, no
network):

```bash
node --test scanner/test/scanner.test.js   # note: a trailing-slash dir arg fails
node --test scalper/test/sim.test.js scalper/test/exit.test.js scalper/test/trader.test.js
# livebot — list files explicitly (the bare `livebot/test/` dir form fails the same way):
node --test livebot/test/feed.test.js livebot/test/paperBroker.test.js \
  livebot/test/sniper.test.js livebot/test/risk.test.js \
  livebot/test/store.test.js livebot/test/replay.test.js
```

## backtest (Python, research only)

`backtest/` is a BTC EMA-crossover backtest — pandas/numpy/matplotlib, no
orders ever (see `backtest/CLAUDE.md`). Verify with:

```bash
cd backtest
pip install -r requirements.txt
python -m pytest            # deterministic unit + pipeline tests, no network
python run_backtest.py      # full run off the cached data/btc_usd_daily.csv
```

The run must work offline from the CSV cache; only `python data.py --refresh`
touches the network (Coinbase public API, Yahoo fallback). Outputs regenerate
into `backtest/results/` — REPORT.md, grid_report.csv, equity_curve.png,
trades CSV.

## livebot (Node sniper, paper-first)

A live pump.fun sniper that runs Pulse's exit engine on real market data. It
needs a persistent process + websockets + a wallet key, so it does NOT run on
GitHub Pages — it runs locally. In the sandbox the PumpPortal websocket is
blocked, so verify it via the **replay** path and the **dashboard** in
isolation (no live feed needed):

```bash
# deterministic full-pipeline replay of the committed fixture → 1 trade
node livebot/index.js --replay livebot/test/fixtures/session.jsonl
# expect: "Replay complete: 24 messages → 1 trade(s)" and a ZETA EMERGENCY_WHALE_DUMP line
```

Dashboard: start `livebot/js/server.js` with a canned `getState` (see the
pattern in the replay test / a small harness) bound to `127.0.0.1:8787`, then
drive it with Playwright at 420×860 — assert the gate bar, a `.pos-card` with
gauges, `.trade-row`s with itemized fees, and a working `#panic` POST, with
zero console errors. `liveBroker.js`/`jupiter.js` require `@solana/web3.js`
(only installed via `npm i` in `livebot/`) and only load in `--live` mode;
`node --check` them for syntax without the dep.

**Safety invariants to keep green:** the repo root `.gitignore` must list
`livebot/.env` and `livebot/data/`; `livebot/js/wallet.js` `assertSafe()` must
refuse live mode if `.env` is tracked; the per-trade cap is a frozen 0.05 SOL
constant in `risk.js`; replay must use a throwaway store so it can't inflate
the go-live gate.
