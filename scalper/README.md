# ⚡ Pulse — smart-exit scalper simulator

A paper-trading memecoin scalper built around an **adaptive smart-exit engine**.
The bot buys, and a hold timer starts — but the timer is only the *default*
exit. Every 250 ms the engine analyzes live market conditions and decides
whether the timer, an extension, an early cut, or an emergency sell gets the
final word. Every run is scored against a dumb **fixed-timer exit on the exact
same market**, so the edge (or lack of it) is measured, not vibes.

## Why a simulator

This was built as a training ground for exit discipline when trading memecoins
on apps like **Fomo** ([fomo.family](https://fomo.family)) — which has no
public API, so a bot cannot legitimately place trades there. Pulse therefore
trades a **synthetic, seeded market**: same seed + scenario replays
byte-identically, which is also what makes every exit rule unit-testable. The
exit engine itself (`js/exit.js`) is deliberately feed-agnostic — it only
consumes `{ t, price, trades, pool, holders, flags }` ticks — so it could be
pointed at a real tick stream later. Nothing here touches real money.

## The smart exit, concretely

The default hold is **4 s**; the engine can stretch it to **10 s** or cut it to
under a second:

- **Momentum analysis** — price velocity (EMA of per-second log returns), the
  buy/sell volume ratio over a rolling 3 s window, and the pressure *trend*
  (recent half vs prior half of the window: is buying pressure rising or
  fading?).
- **Volume analysis** — flow rate of the last 2 s vs the 4 s before it: volume
  acceleration after entry counts toward "strong"; drying volume toward "weak".
- **Liquidity protection** — before any discretionary sell, the engine computes
  the expected constant-product price impact of its own exit. Extreme impact
  defers the sell briefly (max 1.5 s) and splits it into tranches rather than
  dumping into a thin pool.
- **Dynamic holding** — *strong* momentum (velocity + buy ratio + trend +
  volume acceleration all above thresholds) extends the deadline in 1.5 s
  steps up to the 10 s cap; *weak* momentum exits immediately after a short
  post-entry grace.
- **Emergency triggers** — sell instantly, ignoring the impact gate: a top
  holder (≥4 % of supply, or the dev wallet) dumping 35 %+ of their bag, any
  whale-scale single sell, ≥30 % of pool liquidity vanishing within 2 s, a
  contract risk flag flipping on, or selling becoming restricted (detected via
  the flag *or* observed flow: busy tape with zero sells where sells used to
  exist). Restricted exits are attempted and honestly written off when blocked.

Precedence: **emergency → liquidity gate → weak-momentum cut → timer/extension
→ hold.** The seeming contradiction between "avoid selling into liquidity
drops" and "sell immediately when liquidity is pulled" is resolved by scope:
the impact gate only defers *discretionary* exits; emergencies always fire,
because when the pool is draining every millisecond of delay costs more than
slippage.

## Scenarios

Seven scripted markets exercise every path: **Pump then fade**, **Moonshot**
(the extension showcase), **Slow bleed** (instant weak exit), **Rug pull**,
**Whale dump**, **Honeypot** (sell restriction), and **Chop** (control — the
timer should simply fire). By default they appear as blind "Mystery token"
entries, revealed after the exit, so you can't cheat; Settings can un-blind
them. The History tab keeps a running smart-vs-timer scoreboard.

## Running it

No build step, no dependencies, no network. Serve the repo
(`python3 -m http.server`) and open `/scalper/`, or use GitHub Pages
(`https://<user>.github.io/<repo>/scalper/`). On a phone, "Add to Home
Screen" installs it like an app. All state lives in `localStorage`.

Append `?mock=1` to pin seed 42 + the rug-pull scenario for a deterministic,
demonstration-grade run.

## Project layout

```
index.html            app shell
manifest.webmanifest  installable-app metadata
css/style.css         styles (light + dark)
js/config.js          every threshold the engine uses, in one place
js/storage.js         localStorage state
js/sim.js             seeded constant-product AMM market simulator (node-testable)
js/exit.js            the smart-exit engine — pure, feed-agnostic (node-testable)
js/trader.js          run loop + shadow-world fixed-timer baseline (node-testable)
js/app.js             screens, interval loop, canvas chart
test/                 node --test scalper/test/sim.test.js exit.test.js trader.test.js
```

Not financial advice. A simulator win proves the logic, not future returns.
