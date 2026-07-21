# Market-Making Pivot — two-month research plan

## Why we're here

Full-population oracle scoring (see NOTES.md) proved the taker strategy is
negative-EV: the fair model has real predictive skill (log-loss 0.573 vs
0.693 coin-flip on 1528 oracle-resolved markets), but that skill is smaller
than the bid-ask spread we cross to enter. Taking liquidity on efficient
short-horizon markets can't win. Market-making flips the spread from a cost
into revenue — IF we can survive adverse selection.

## The core tension

- **Upside:** rest limit orders (bid below fair, ask above). Balanced flow
  earns the ~2-4c spread instead of paying it. Our proven model tells us
  where fair is, so we quote around a value we price better than chance.
- **The enemy — adverse selection:** a resting order is a free option for
  everyone else. When spot ticks, faster traders lift our stale quote before
  we can cancel. We are structurally slow (home connection, ~2.5s book
  polling), so on FAST markets we get picked off relentlessly.

## Venue decision (locked): slower CRYPTO markets

Hourly / daily up-down and strike markets on Polymarket + Kalshi. Rationale:
- Keeps our proven spot+vol fair model (just longer tau). Non-crypto events
  would discard our only real asset.
- Slower resolution ⇒ spot moves less per unit time relative to the window ⇒
  a 2.5s-slow maker is not instantly picked off.
- Still liquid enough to earn spread, but less bot-saturated than 5-min.

## What we do NOT yet have

Maker profitability lives in FILL TIMING (did we get filled right before an
adverse move?). Our weekend tapes recorded book SNAPSHOTS every 2.5s, not the
TRADE TAPE (executions: price/size/time). We cannot honestly backtest maker
fills from snapshots alone. Getting the trade tape is Phase 0.

## Phased plan (~8 weeks, no deadline pressure)

### Phase 0 — Data foundation (build first)
- Broaden discovery to slower crypto markets (hourly/daily), alongside (not
  replacing) the existing 5-min taker run.
- Capture the CLOB **trade tape** + **full book depth** — ideally via
  Polymarket's CLOB websocket (`wss://ws-subscriptions-clob.polymarket.com`,
  market channel pushes trades + book), Kalshi's equivalent, polling as
  fallback. Record to sessions for replay.
- Run on desktop to accumulate maker-grade data (days-weeks).
- Deliverable: recorded tapes that contain real executions we can test
  hypothetical resting orders against.

### Phase 1 — Maker fill simulator + naive baseline
- Simulator: given our resting quotes and the real trade tape, determine
  which of our orders would have filled, at what time, and mark the
  post-fill adverse move (did spot move against us right after?).
- Measure the NAIVE maker: quote fair +/- half-spread, no inventory logic.
- Key metric: spread captured MINUS adverse-selection cost, oracle-settled.
- Decision gate: if naive maker is not clearly positive on slower markets,
  the whole pivot is questionable — report honestly, don't force it.

### Phase 2 — Maker strategy (only if Phase 1 is promising)
- Inventory management: cap net position; skew quotes to mean-revert
  inventory (quote more aggressively on the side that flattens us).
- Quote width as a function of vol/tau/depth; widen when uncertain.
- Cancel/reprice cadence: reprice on material spot moves within our latency.
- Adverse-selection defense: pull quotes near known-fast moments.

### Phase 3 — Paper-live maker + gate
- Run the maker paper against live slower markets.
- Oracle-score; gate = positive net-of-adverse-selection PnL over 100+ fills,
  REPLICATED across independent weeks/regimes (one green window is never the
  verdict — the weekend taught us that twice).
- Only after multiple independent green gates is real money a conversation,
  and then under the frozen tiny-size caps that already exist in risk.js.

## Discipline (unchanged)

One hypothesis at a time; backtest against recorded tapes; replicate
out-of-sample before believing; oracle truth over feed-judged; kill ideas the
data rejects (we've killed two already: overnight-hours, vol-gate). The maker
pivot gets the same treatment — no exceptions because we want it to work.

## Honest odds

Slow retail market-making is hard; many capable people find no durable edge.
But it's the structurally correct lever, applied to a venue where our proven
model still works and our slowness is survivable. That's a real shot, and the
rigorous toolkit we built is exactly what tells a real edge from a mirage.

## PHASE 0 FINDING (desktop probes) — CRYPTO VENUE CLOSED

CLOB ws schema captured (book = full depth; price_change carries
best_bid/ask). The ws market channel does NOT emit trade events, so the
"0 trades" reading was a measurement artifact. Definitive check via data-api
trade history:
  BTC above $64k (1-6h): 192 trades/hr, spread 0.1c
  BTC reach $75k (>48h): 75 trades/hr, spread 0.1c
  BTC above $60k (1-6h): 27 trades/hr, spread 0.1c
  BTC dip $57.5k (>48h): 23 trades/hr, spread 0.2c

Flow EXISTS (dozens-200/hr) but spreads are ~0.1c and the book reprices
~11x/sec (668 price_changes/min observed). Market-making earns the spread;
there is essentially none, and a 2.5s-slow maker loses the quote queue to
faster bots, taking only adverse fills. Crypto markets are hyper-efficient
because fair value = a public instant price feed: no informational edge, and
(being slow) no speed edge.

VERDICT: crypto prediction markets offer no retail edge, taking OR making.
Venue closed. The ONLY structural place a slow retail edge can live is markets
where fair value is NOT publicly computable — non-crypto events (politics,
sports, niche/long-horizon) with wider spreads and genuine uncertainty. That
is an INFORMATION edge (research/model beats the crowd), not a speed/spread
edge — the one kind slowness does not disqualify. It is the Scout (scanner/)
thesis, now equipped with the rigor built here (oracle scoring, replay,
out-of-sample replication). Odds remain humbling (prediction-market crowds are
well-calibrated), but it is the only structurally-valid direction left.
Crypto market-making build: HALTED before the collector.
