# 📈 MFFU Trade Copilot

An AI chart-analysis assistant + rules guardian for **MyFundedFutures 25k evaluations**.
Paste a chart screenshot, get a disciplined **LONG / SHORT / NO TRADE** read with entry,
stop loss, and two take-profits — automatically position-sized against your remaining
drawdown so a single trade can never breach your account.

## What it does

- **🎯 Analyze** — paste (Ctrl+V), drag, or upload up to **3 chart screenshots** (e.g. a
  15-minute chart for bias plus a 2-minute chart for the entry — the AI does top-down
  analysis and refuses trades where the timeframes disagree). Declare your entry timeframe
  and style (scalp / day / swing) so stops and targets fit how you actually trade. Claude's
  vision model returns a signal with entry / SL / TP1 / TP2, its confidence, the reasoning,
  and what would invalidate the idea. The prompt is deliberately biased toward **NO TRADE**
  — unclear charts get a pass, because standing aside costs nothing and breaches cost
  everything. Signals offering under 1.2R to TP1 are auto-downgraded to NO TRADE, and a
  configurable **confidence threshold** (default 65%) gates low-conviction reads.
- **🛡️ Account** — a live model of your MFFU account: balance, the EOD-trailing Max Loss
  Limit (with the $25,100 lock), buffer to breach, profit-target progress, today's P&L,
  trading days, and the consistency meter on plans that have one. An **End my day** button
  rolls the trailing drawdown exactly the way MFFU computes it.
- **📏 Position sizing** — every signal is audited before you see it: stop distance → ticks
  → dollars → max contracts risking at most your configured % (default 25%) of the
  remaining buffer, capped at the plan's contract limit. If even one contract risks too
  much, you get a hard **DON'T TAKE THIS TRADE** banner instead of a size.
- **📓 Journal** — log trades (one tap from a signal), track win rate and net P&L; entries
  update the account model automatically.
- **📊 AI accuracy tracking** — trades logged from signals are linked back to them, so the
  Journal shows the AI's real win rate broken down by confidence bucket and timeframe.
  If low-confidence reads aren't hitting, raise the threshold in Settings — the tool tells
  you when to trust it.

Editable plan presets: **Rapid 25k/50k/100k**, **Builder 25k/50k**, and the legacy
**Starter/Flex 25k**. The 50% evaluation consistency rule (all plans except Builder) is
tracked live. Instruments: ES, MES, NQ, MNQ, YM, MYM, RTY, M2K, GC, MGC, CL, MCL.

## Setup (2 minutes)

1. Open the app (GitHub Pages: `https://<user>.github.io/<repo>/tradebot/`) — or locally:
   serve the repo (`python3 -m http.server`) and open `/tradebot/`.
2. Get a Claude API key at [console.anthropic.com](https://console.anthropic.com)
   (pay-as-you-go; an analysis costs roughly a cent).
3. Pick your plan, paste the key, hit Start. On a phone, use "Add to Home Screen" to
   install it like an app.

Your API key and all data stay in your browser's `localStorage`. The only network call the
app ever makes is directly to `api.anthropic.com`.

## Honest expectations — read this

**Nothing can guarantee you pass an evaluation**, and anyone who promises that is selling
something. A screenshot contains no order flow, no news, no higher-timeframe context — the
AI reads structure the way a disciplined human analyst would, and it will often (correctly)
tell you to do nothing.

Where a tool like this genuinely helps: most evaluations die from **rule breaches,
oversizing, and revenge trading**, not from bad chart reads. The Copilot never gets tilted,
never forgets where the Max Loss Limit is, and never takes a position that could end the
account in one trade. Treat it as a second opinion and a risk officer — not a money printer.

Plan presets reflect MFFU's published rules as of mid-2026. **Rules change** — verify every
number against your own MFFU dashboard (Settings lets you edit them all). This is not
financial advice; every trade is your decision and your responsibility.

## Project layout

```
index.html            app shell
manifest.webmanifest  installable-app metadata
css/style.css         styles (light + dark)
js/config.js          plan presets + futures contract specs
js/storage.js         localStorage state
js/rules.js           rules engine (pure functions, node-testable)
js/analyzer.js        Claude vision call + response validation
js/journal.js         account bookkeeping + trade journal
js/app.js             screens & wiring
```

Append `?mock=1` to the URL to exercise the UI with canned signals (no API key needed).
