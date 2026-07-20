# Cloud live-paper research notes (weekend run, July 2026)

## Findings so far (Thu evening UTC)

1. **Confidence floor is real and coded.** Live settles split: model ≥60% went
   44-0 (+$252 settles), sub-60% went 8-19 (−$67). The `minEntryFair` knob is
   committed (default 0/off). RECOMMENDED SETTING once verified: 0.60 in
   `data/settings.json`.

2. **Settlement basis is untrustworthy on 5-minute windows.** Replaying the
   day's recorded tape with the identical config scored 38-24 where the live
   run scored 44-0 — the only difference is spot sampling granularity
   (recorded 250ms throttle vs every live tick). Borderline windows flip.
   Consequence: our feed-judged W-L and PnL carry real measurement error;
   only oracle resolutions count. `oracle-check.js` (this directory) scores
   the trade log against Polymarket's actual resolutions.

3. **Flip-exit verdict is OPEN — do not act yet.** Live suggested flip exits
   destroyed $178 of winning positions; replays suggest flip-off is worse.
   Both views are contaminated by (2). Decide only after oracle-scoring, and
   prefer measuring on data where settlement is oracle-confirmed.

## Config epochs (for analysis)

- Run start Thu ~13:04 UTC: band [0.30, 0.85], minEdge 0.08, flip 0.09,
  NO confidence floor.
- Thu ~22:10 UTC: floor 0.60 ACTIVE (restart after silent process death at ~19:55 UTC; research dailyStopUsd raised 100→250 and the pre-floor halt flag cleared so the floored config collects overnight).

## Oracle-true results (98/98 settled trades resolved, Thu 22:09 UTC)

- Feed-judge accuracy: 92/98 (6 borderline flips, −$66 of phantom PnL).
- Oracle-true settled record: 64-34, +$73.86.
- hi-conf (model ≥60%): **58-2, +$301.23** — the edge is real, confirmed by ground truth.
- lo-conf (<60%): 6-32, −$227.37 — floor justified conclusively.

## Oracle policy grid (all 287 real entries, Thu ~22:25 UTC)

Hold-to-resolution beats flip-exit at EVERY floor level. Winner installed:
floor 0.60 + exitFlipEdge 999 → oracle-true 124-65, +$104.93 (~$0.56/trade).
Flipped hi-conf positions would have won only 51% if held — confidence
collapse mid-window marks entries that were bad at birth (likely taken too
near the window open); investigate an entry-timing guard with Sunday data.
Caveat: one afternoon, one regime; counterfactual ignores slot contention
from longer holds.

- Thu ~22:26 UTC epoch: floor 0.60 + flip OFF (hold to resolution) ACTIVE.

## Overnight oracle scoring (Fri 09:55 UTC, floor+hold epoch, 239 entries)

Oracle-true: 135-104 (56.5%), net −$56.04. The edge is HOUR-DEPENDENT:
US-evening hours (22:00–00:59 UTC) went +$148 over 52 entries; the overnight
stretch (01:00–09:59 UTC) went −$203 over 187. Mechanism hypothesis: low
overnight volatility keeps spot pinned near each window open, so 60–70%
model confidence is whipsaw noise and entries are coin flips bought at
60–70¢. DECISION DEFERRED: one night is one sample — collect Fri/Sat data,
decide a trading-hours guard (or vol-regime gate) Sunday with two nights of
evidence. Feed-judge disagreement rate steady at ~5% (11/239).

## REPLICATION VERDICT (Sun 09:35 UTC) — overnight bleed did NOT replicate

Second overnight sample (Sat night, Sun 01:00-10:00 UTC, 145 oracle-scored):
**88-57 (60.7%), +$2.74** — POSITIVE. Contradicts Fri night (135-104, −$203).
Same config, same hours, opposite sign ⇒ the Fri "overnight loses" pattern
was NOISE, not signal. A time-of-day guard would have curve-fit one night.
HELD DECISION CORRECTLY. Real driver is VOLATILITY not the clock (Sat night
had active crypto and traded fine). CORRECT next improvement: a realized-vol
regime gate (stand down when vol too low to price meaningfully), NOT a
trading-hours rule. Design + backtest against both nights' recorded tapes
before installing. Note: window partial (2 markets unresolved; ~02:25 UTC
container restart cost the first overnight hour).

## VOLATILITY GATE BACKTEST (Sun, all recorded tapes, 810 settled) — HYPOTHESIS REJECTED

Replayed 1.4GB of weekend tapes; recorded entrySigmaHourPct per entry.
PnL by vol bin (pct/sqrt-hr): [0,.05)=-38(n8) [.05,.1)=+137(n114)
[.1,.2)=-5(n213) [.2,.4)=-100(n312) [.4,.8)=+156(n152) [.8+)=-31(n11).
Losers cluster in the MIDDLE (.2-.4), not at low vol; the low band (.05-.1)
is profitable. A vol FLOOR is the wrong shape - cannot isolate a mid band.
Threshold sweep: off=+120, 0.05=+161 (cuts 8 dead trades), 0.10=+21,
0.30=-20. Only a tiny 0.05 floor helps, marginally; anything higher HURTS.
DECISION: DO NOT ship a vol gate. Keep minSigmaHourPct=0. Same lesson as
the overnight-hours false lead - a tempting pattern that dissolved under
measurement. Caveats: settlement feed-judged (~5% noise); session tapes may
double-count markets at boundaries; extreme bins tiny n. Infrastructure
(sigma logging) KEPT - live desktop run now accumulates clean
oracle-scorable sigma data to revisit with a bigger sample later.

## FULL-POPULATION ORACLE VERDICT (Sun, desktop pickup) — NO PROVEN EDGE

Replayed ALL weekend tapes under uniform final config (band .30-.85,
floor .60, hold), settled every trade against Polymarket oracle. This is
the most rigorous number we have and it is NEGATIVE:
  vol 10min: 810 trades, 61.4% win, net -151 (-0.19/trade)
  vol 2min (best log-loss): net -357; vol 3min: net -238.
Shorter vol IMPROVES calibration (log-loss 0.573 vs 0.580) but WORSENS
PnL - more reactive fair fires on spurious edges. Model beats coin flip
(0.573 vs 0.693 log-loss on 1528 oracle-resolved markets) = real
predictive skill, but the skill is SMALLER THAN THE SPREAD we cross.

Earlier positive oracle numbers (+104.93 Thu, +0.56/trade) were favorable
selection: the live daily-stop cut losing streaks + small samples. The
live desktop drawdown (-49 over 27) matches the true -0.19/trade.

minEdge sweep (10min vol, oracle): 8c=-151, 12c=-227, 16c=-106, 20c=-146,
25c=+143 (196 trades, +0.73/trade). ONLY the extreme 25c bucket is
positive, and NON-MONOTONICALLY - overfitting signature. Also 25c gaps
likely = thin/stale books where paper fills are optimistic. Treat as an
UNCONFIRMED hypothesis, not a strategy.

CONCLUSION: no demonstrated robust positive edge. DO NOT risk real money.
The model has skill; costs eat it. Only real lead = large-divergence
regime, which must be replicated out-of-sample on fresh data AND checked
for fill realism (book depth at entry) before any belief. Paper run keeps
collecting because it is free and generates independent test data.

## Files

- `cloud-weekend-trades.jsonl` — snapshot of the live paper trade log.
- `cloud-weekend-status.json` — latest gate/ledger/calibration snapshot.
- `oracle-check.js` — score trades against real Polymarket resolutions.
