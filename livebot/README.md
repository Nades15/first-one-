# 🤖 Livebot — live pump.fun sniper (paper-first)

Livebot auto-snipes new pump.fun launches and manages each position with the
**exact same adaptive smart-exit engine** proven in [Pulse](../scalper/) — the
one that extends a hold on strong momentum, cuts it on weakness, and slams the
exit on rugs, whale dumps, and honeypots. It runs on **your** computer, signs
with **your** burner wallet, and shows a Pulse-style dashboard at
`127.0.0.1`.

It starts in **paper mode against the live market** and refuses to touch real
money until a stats gate is satisfied. This is deliberate. Please read the
expectations section before you fund anything.

> **Not financial advice. This is high-risk software that can lose 100% of
> whatever you put in front of it. You are responsible for every trade it
> makes.** A green paper gate proves the plumbing works, not that you will make
> money.

## How it works

```
PumpPortal websocket ──▶ feed ──ticks──▶ positions ──decide()──▶ broker (paper│live)
        │                  │                 │  ▲                       │
   new launches         sniper            SXExit (reused)         Helius RPC / signing
                     (entry filters)           │
                                          risk caps · stats gate · panic
```

- **Sniper** watches launches and enters only those clearing config filters
  (dev buy size, unique buyers, net SOL inflow, dev holding %, curve size).
  Every skip is *shadow-tracked* — Livebot records what would have happened —
  so paper mode becomes a dataset for tuning the filters instead of a guess.
- **Exit** is `scalper/js/exit.js`, unchanged. Bonding-curve virtual reserves
  map straight onto the engine's pool shape, so momentum, volume, impact, and
  the emergency detectors all work on live data.
- **Broker** is swappable: `PaperBroker` simulates fills from the live curve
  with honest fees and latency; `LiveBroker` signs locally and submits via
  PumpPortal's Local Transaction API over your own RPC.

## Requirements

- **Node.js ≥ 20** (uses built-in `fetch`, `node:test`, `node:http`).
- A **Solana RPC URL** — a free [Helius](https://dashboard.helius.dev) key works.
- A **burner wallet** you fund with a small amount you can afford to lose.

## 1. Install

```bash
cd livebot
npm install          # @solana/web3.js, ws, bs58 — only needed for live mode
```

Paper mode and the tests need no install and no network beyond the public feed.

## 2. Make a burner wallet

Never use a wallet holding anything you care about. Create a fresh one:

```bash
solana-keygen new --outfile burner.json    # then read out the base58 secret
```

…or export a private key from Phantom (Settings → Security → Export Private
Key). Fund it with a **small** amount — start with ≤ 0.3 SOL. This key controls
those funds; treat it like cash.

## 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `HELIUS_RPC_URL` — your RPC endpoint.
- `WALLET_SECRET_KEY` — the burner's base58 secret key.

`livebot/.env` is gitignored. Livebot **refuses to arm live mode** unless the
file is both gitignored and untracked, so your key can't be committed by
accident.

## 4. Run paper mode

```bash
node livebot
```

Open the dashboard at `http://127.0.0.1:8787`. Paper mode trades the live feed
with simulated fills — no wallet needed, no real money at risk. Leave it
running. You'll see launches stream in, positions open and close, and the
trade log fill with itemized fees.

**What the gauges mean** (per open position): `vel %/s` price velocity,
`buy %` share of volume that's buys, `vol ×` volume acceleration, `impact %`
expected slippage of our own exit — green/amber/red against the engine's
thresholds, exactly like Pulse.

## 5. Read the gate

Live mode stays **locked** until the paper log shows:

- **≥ 50 completed paper trades**, AND
- **net-positive PnL after fees**.

The dashboard shows progress. Treat 50 as a *floor*, not a finish line —
a few hundred trades tell you far more, and the number that matters is whether
you're **net up after the ~4.5% round-trip cost** (see below).

## 6. Arm live (only once the gate is open)

```bash
node livebot --live
```

Livebot will refuse unless **all** of these hold: the gate is unlocked, your
`.env` is safe, the RPC/key validate, and you type `ARM LIVE` at the prompt.
Then it trades for real, under hard caps you cannot raise from config:

- **0.05 SOL per trade** (frozen ceiling; config can only lower it)
- **max 3 concurrent positions**
- **0.15 SOL daily net-loss stop** → halts sniping until UTC midnight
- keeps **≥ 0.05 SOL** in the wallet for fees/rent

## 7. Kill switch

- **PANIC button** on the dashboard — best-effort sell everything, then halt.
- **Ctrl-C** — first press panic-sells and exits; second press exits immediately.

## Tuning offline with replay

Every session is recorded to `data/sessions/*.jsonl`. Replay one deterministically:

```bash
node livebot --replay data/sessions/<file>.jsonl
```

Replays use a throwaway store (they never touch your real trade log or the
gate). Edit thresholds in `data/settings.json` (overrides `js/config.js`) and
replay the same session to see the effect — this is how you calibrate the
sniper filters and the exit thresholds to real flow.

## Unvarnished expectations — please read

- **Fees are brutal at this size.** pump.fun ~1%/side + PumpPortal 0.5%/side +
  a flat priority fee that's ~0.6%/side on a 0.05 SOL trade ≈ **~4.5% round
  trip**. The average winning trade must clear ~4.5% before you're up a lamport.
  The gate measures net-of-fees for exactly this reason.
- **You are latency-disadvantaged.** From a home connection you're 200–800 ms
  behind bots co-located with the RPC that snipe the same launches. The paper
  broker models 400 ms of adverse latency; live may be worse.
- **Most launches go to zero, and most snipers lose money net of fees.** The
  smart exit reduces damage from *delayed* exits; it cannot make a bad entry
  good. The entry filters are unproven — that's what paper mode is measuring.
- **The exit thresholds were tuned on a simulator.** Live pump.fun flow is
  faster and spikier; expect to recalibrate via replay before they fit.
- A green gate is a *minimum bar to consider risking money*, not a prediction.
  Size accordingly, and never add funds you can't afford to lose.

## Project layout

```
index.js              CLI entry: paper (default) / --live / --replay / --record-only
.env.example          copy to .env (gitignored)
js/config.js          every threshold (FEED / SNIPER / TRADE / FEES / RISK / EXIT)
js/env.js             .env parser + validation
js/wallet.js          local signing; refuses live if .env is unsafe
js/feed.js            PumpPortal ws, strict normalizer, TickBuilder, holders, recorder, replay
js/sniper.js          entry filters + skip-shadowing
js/broker.js          shared fee model
js/paperBroker.js     simulated fills on live reserves + latency + fees
js/liveBroker.js      trade-local → local sign → send → confirm → real accounting
js/jupiter.js         graduation exit fallback (sell only)
js/positions.js       per-position SXExit engine, tranches, force-exit
js/risk.js            caps, daily stop, stats gate, panic
js/store.js           JSONL/JSON persistence under data/ (gitignored)
js/server.js          127.0.0.1 dashboard server
public/               dashboard (Pulse visual language)
test/                 node --test (feed, paperBroker, sniper, risk, store, replay)
```

The smart-exit engine itself lives in [`../scalper/js/exit.js`](../scalper/js/exit.js)
and is reused verbatim — Livebot is the live harness around it.
