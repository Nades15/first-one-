# Non-Crypto Information-Edge Direction — research plan

## Why here (and why not crypto)

Crypto prediction markets are closed to a slow retail participant: proven
negative-EV as a taker, ~0.1c spreads as a maker (see NOTES.md +
MARKET-MAKING.md). Root cause: crypto fair value is a public, instant price
feed, so there is no information edge and, being slow, no speed edge.

The only structural place a slow retail edge can live is markets where fair
value is NOT publicly computable — non-crypto events (politics, sports,
culture, niche, long-horizon). There, edge = INFORMATION (a model/analysis
that beats the crowd), which slowness does not disqualify.

## Phase 1 — CALIBRATION STUDY (measure before building)

Do NOT build a strategy yet. First answer one empirical question: do
Polymarket non-crypto crowds show systematic, exploitable miscalibration?

### Primary hypothesis: favorite-longshot bias
The most robust known inefficiency in betting markets (horse racing, sports,
elections): crowds OVERPAY for longshots and UNDERPAY for favorites. A 5%
contract that should be 5% trades at ~8%; a 92% favorite trades at ~88%. If
present on Polymarket, it is a structural, information-free edge: systematically
BUY favorites / FADE longshots. Directly tradeable by a slow participant.

### Method
1. Pull many RESOLVED (closed=true) non-crypto binary markets from Gamma
   (`gamma-api.polymarket.com/markets?closed=true&limit=...&order=volumeNum`).
   Exclude crypto (btc/eth/sol/etc). Keep those with a clear YES/NO outcome
   (outcomePrices settled to [1,0] or [0,1]) and clobTokenIds.
2. For each, get the price at a FIXED LEAD before resolution (e.g. 24h and 7d)
   via `clob.polymarket.com/prices-history?market=<tokenId>&interval=max&fidelity=60`.
   Sample the price closest to closeTime - lead. This is the crowd's estimate.
3. Record (predictedPrice, actualOutcome, category, volume, liquidity, lead).
4. Bucket by price decile; compute actual YES-rate per bucket vs the bucket's
   mean price. Favorite-longshot bias shows as: low-price buckets resolve YES
   LESS than priced (longshots overpriced), high-price buckets resolve YES MORE
   than priced (favorites underpriced). Plot the calibration curve.
5. Also bucket by CATEGORY (politics/sports/culture/...) — bias strength varies
   by category; some may be strongly biased, others efficient.

### Decision gate
- If a robust bias exists (calibration curve deviates from diagonal beyond
  noise, on a large sample, replicated across time periods) AND the deviation
  exceeds transaction costs (spread + any fees) → we have a candidate edge.
- If crowds are well-calibrated everywhere → honest null result; reconsider.

### Honest caveats (state up front)
- Prediction-market crowds are often well-calibrated; a null result is likely
  and legitimate.
- Longshot/biased markets are often the ILLIQUID ones with WIDE spreads — the
  bias may be real but uncapturable after crossing the spread. Must check the
  executable spread on the biased buckets, not just the mid-price bias.
- Survivorship/selection: only resolved markets; be careful the sample isn't
  skewed (e.g. only high-volume markets).
- Settlement = actual UMA resolution (outcomePrices), the ground truth.

## Phase 2+ (only if Phase 1 finds a robust, cost-beating bias)
- Build a strategy that bets the bias (e.g. buy favorites above price P in
  category C), backtest out-of-sample on a held-out time period, then paper-live
  with oracle scoring and the same replicated-gate discipline. Reuse the
  Fairline engine (discovery, paper broker, positions, risk, oracle-check).

## Execution note
Phase 1 is pure historical data analysis — reachable from the cloud (Gamma +
clob are allowlisted) OR runnable on desktop. It needs a session with working
command execution (this session's safety layer began blocking bash after a very
long thread). Recommend a FRESH session: point it at this file and run the
calibration study first.
