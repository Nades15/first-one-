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

## Files

- `cloud-weekend-trades.jsonl` — snapshot of the live paper trade log.
- `cloud-weekend-status.json` — latest gate/ledger/calibration snapshot.
- `oracle-check.js` — score trades against real Polymarket resolutions.
