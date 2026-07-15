# 📈 BTC EMA-Crossover Backtest

A research backtest of a long-only trend-following strategy on BTC/USD daily
bars (2019 → today): fast/slow EMA crossover entries, ATR-based stops, fixed-R
or crossover exits, tested across a 5-combo EMA grid with realistic costs and
a strict in-sample / out-of-sample split.

**Research only — nothing here places orders.** See `CLAUDE.md` for the rules.

## Why

Single-cell backtest winners are usually noise. This project reports the
**full grid** (not just the best cell), splits everything in-sample
(2019–2023) vs out-of-sample (2024–today), and selects the final combo by
**neighbor-smoothed in-sample expectancy** — the best plateau, not the best
spike — validated (never selected) on out-of-sample data.

## The strategy

- **Entry:** fast EMA closes above slow EMA → buy the **next day's open**
  (no lookahead). Grid: 9/21, 12/26, 20/50, 50/100, 50/200.
- **Stop:** 2×ATR(14) below entry = 1R. Fixed, always active.
- **Exit A:** fixed 2R take-profit. **Exit B:** opposite crossover
  (exit next open). Both are tested.
- **Sizing:** risk 1% of current equity per trade, $5,000 start, notional
  capped at 100% equity (no leverage).
- **Costs:** 0.1% fee per side + 0.05% slippage per side, on every fill.
- Pessimistic fills: same-day stop+target → stop; gaps through a level fill
  at the open.

## Running it

```bash
pip install -r requirements.txt
python run_backtest.py            # uses data/btc_usd_daily.csv cache
python run_backtest.py --refresh  # force re-download of the data
python -m pytest                  # unit tests (no network)
```

Data comes from the Coinbase Exchange public candles API (Yahoo Finance
fallback) and is cached at `data/btc_usd_daily.csv` so reruns are offline.

Outputs land in `results/`: `grid_report.csv` (every cell), `REPORT.md`
(readable tables + pick rationale), `equity_curve.png` and
`trades_<combo>.csv` for the robust pick.

## Project layout

```
config.py         every tunable: grid, dates, risk, costs, paths
data.py           download (Coinbase → Yahoo fallback) + CSV cache + validation
indicators.py     EMA, Wilder ATR
engine.py         causal event-loop backtest → trades + daily equity
metrics.py        win rate, expectancy(R), profit factor, max DD, CAGR
run_backtest.py   grid runner, robustness pick, report/chart/CSV writers
tests/            deterministic unit tests for engine, indicators, metrics
data/             cached BTC/USD daily OHLCV
results/          generated reports and charts
```
