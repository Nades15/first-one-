# 📐 Fairline — prediction-market paper trader

Fairline watches the short-horizon **crypto markets on Polymarket and Kalshi**
("Will Bitcoin be above $118,000 at 5 PM?", "BTC up or down this hour?"),
computes its own probability for each one from a **live exchange spot feed +
realized volatility**, and paper-trades the gap whenever the market's price
sits further from that fair line than spread + fees. It runs on **your**
computer as a Node process with a Pulse-style dashboard at `127.0.0.1:8788`,
and it is **paper-only** — there is no live mode to arm.

> **Why this exists.** Social media is full of screenshots of "AI quant bots"
> supposedly printing $200k+ on Polymarket by front-running slow odds. Those
> dashboards are fabricated marketing — the numbers in them are internally
> impossible, and the accounts posting them are selling something. But the
> *strategy class* they gesture at (prediction-market prices lagging faster
> reference feeds) is real, small, and measurable. Fairline is the honest
> version: same idea, real order books, real fees, and a calibration chart
> that tells you whether the edge exists **instead of assuming it does**.

## How it works

```
spot ws (Coinbase → Binance fallback) ──ticks──▶ EWMA vol ──▶ fair line ─┐
                                                                         ├─▶ strategy ─▶ paper broker ─▶ positions ─▶ settle
discovery (Gamma + Kalshi, 60s sweep) ──▶ book poller ──executable──────┘        │
                                                     risk caps · stats gate · recorder/replay · dashboard
```

- **Fair line** — for a market resolving on the spot price at time T, with
  spot S, strike K, τ seconds left, and σ from an EWMA of 1-second log
  returns: `P(above) = Φ(ln(S/K)/(σ√τ))`. Range and below markets are the
  same expression with two bounds; hourly up/down markets get their strike
  captured live at the window open (missed the open ⇒ the market is skipped,
  never guessed).
- **Strategy** — buy YES when `fair − ask − fee > minEdge` (default 5¢), buy
  NO on the mirror condition, hold to resolution, exit early only if the book
  over-prices the held side by `exitFlipEdge`. Guards: never inside 2 minutes
  of close, never on a stale book, never past the depth at the top of the
  book.
- **Broker** — paper fills **walk the real order book** (never the mid),
  execute `paperLatencyMs` after the decision against whatever the book looks
  like *then*, and charge Kalshi's `ceil(0.07·C·P·(1−P))` taker fee
  (Polymarket charges no trading fee on these markets today — its honest cost
  is the spread you cross).
- **Settlement** — at close, the recorded spot decides the outcome and the
  trade is logged with the model's entry-time probability, feeding the
  dashboard's **calibration chart**: model % vs how often that side actually
  won. Dots on the diagonal = honest model; dots below = the "edge" was
  overconfidence.

## Run it

Requires **Node ≥ 20**. Paper mode and the tests need nothing else; `ws` (the
only dependency) is used for the live spot websocket:

```bash
cd fairline
npm install          # just ws

node fairline                # paper-trade live markets (from the repo root)
node fairline --mock         # offline synthetic world — no network, no keys
node fairline --replay FILE  # deterministic replay of a recorded session
node fairline --record-only  # record the live feeds without trading
```

Open `http://127.0.0.1:8788`. In paper mode you'll see the spot tiles warm up
(the vol estimator needs ~1 minute of samples before anything can be priced),
markets appear as discovery sweeps land, and — when a gap actually clears the
guards — positions open, ride to resolution, and settle into the trade log.

`--mock` runs the identical pipeline against a seeded synthetic world with
**planted** mispricings, so entries/settlements happen within minutes. It
proves the plumbing, not the edge.

## The stats gate

Like Livebot, Fairline separates "the plumbing works" from "this makes
money". The gate on the dashboard stays locked until the log shows
**≥ 100 settled paper trades AND net-positive PnL after fees**, and the
calibration chart is the tiebreaker on whether the model's probabilities mean
anything. There is deliberately no live broker in this codebase; if the gate
ever goes green and *stays* green across weeks and market regimes, that is
the moment to start researching live execution — not before.

## Recording & replay

Every session's inputs (spot ticks, discovery sweeps, book snapshots) are
recorded to `data/sessions/*.jsonl`. Replay one deterministically:

```bash
node fairline --replay fairline/data/sessions/<file>.jsonl
```

Replays use a throwaway store — they never touch the real trade log or the
gate. Edit thresholds in `data/settings.json` (overrides `js/config.js`) and
replay the same session to see the effect. A committed fixture at
`test/fixtures/session.jsonl` replays to exactly one settled winning trade.

## Unvarnished expectations — please read

- **The visible gap is usually bait.** When a book looks 8¢ wrong, the size
  at that price is often small, and the people quoting it reprice faster than
  a home connection reacts. Paper fills model latency and walk the book, but
  live would still be worse: you'd win the stale quotes nobody wants and miss
  the ones everybody wants (adverse selection).
- **The model is deliberately simple.** Driftless log-normal with a
  10-minute vol window mis-prices jumps, news, and regime changes — exactly
  the moments that create juicy-looking gaps. The calibration chart exists
  to catch this; believe it over your excitement.
- **Fees and spread eat small edges.** Kalshi's fee alone is ~1.7¢ on a 50¢
  contract, round-trip spread is typically 2–6¢ on these books. `minEdge`
  is 5¢ for a reason.
- **A green gate is a minimum bar, not a prediction.** 100 trades is a small
  sample; short-horizon crypto markets are one regime. Nothing here is
  financial advice, and if you ever do trade prediction markets with real
  money, platform access is regulated and geo-restricted — check what's legal
  where you live (Kalshi is CFTC-regulated in the US; Polymarket's US access
  runs through its regulated exchange and is not available everywhere).
- **Those Instagram bots are still fake.** If Fairline's paper log ends up
  net-negative, that's not a failure of the project — that's the project
  working: it measured the thing the ads wouldn't.

## Project layout

```
index.js            CLI entry: paper (default) / --mock / --replay / --record-only
js/config.js        every threshold (SPOT / DISCOVERY / BOOKS / STRATEGY / TRADE / FEES / RISK)
js/fair.js          fair-value math: Φ, P(floor < S ≤ cap), EWMA vol estimator
js/spot.js          Coinbase/Binance trade ws with reconnect + venue rotation
js/markets.js       Polymarket Gamma + Kalshi discovery → one normalized market shape
js/books.js         CLOB / Kalshi order books → one canonical YES-side book
js/strategy.js      pure decisions: entries, flip exits, guards, resolution logic
js/paperBroker.js   tick-driven fills that walk the real book + honest fees
js/positions.js     open positions, mark-to-book, settlement records
js/risk.js          stake ceiling, concurrency, daily stop, stats gate
js/pipeline.js      wires it all together; same code path live, mock, and replay
js/replay.js        session recorder + deterministic replay source
js/mock.js          seeded offline world with planted mispricings
js/store.js         JSONL/JSON persistence under data/ (gitignored)
js/server.js        127.0.0.1 dashboard server
public/             dashboard (Pulse visual language, calibration chart)
test/               node --test (fair, markets, books, strategy, broker, risk, store, pipeline, replay, spot)
```

The Scout scanner (`../scanner/`) is the on-demand cousin of this app; its
API endpoints and normalization approach seeded `js/markets.js`, and
Livebot (`../livebot/`) provided the paper-first architecture this follows.
