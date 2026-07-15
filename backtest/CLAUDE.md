# Backtest project rules

This folder is **research only**.

- **Never place live orders.** No exchange keys, no order-execution code, no
  "paper trading against a live account" — nothing in here may transact.
  Output is analysis: tables, charts, CSVs.
- **Every backtest must include transaction costs** — at minimum an exchange
  fee and a slippage assumption per side (see `config.py`). A result without
  costs is not a result.
- **Every backtest must report an in-sample / out-of-sample split.** Parameter
  or strategy selection uses in-sample data only; out-of-sample is validation
  and is never searched over.
- **No lookahead.** A signal computed on bar t's close may act at bar t+1's
  open at the earliest. When intrabar ambiguity exists (stop and target both
  touched), resolve it pessimistically.
- Prefer the cached CSV in `data/` — don't re-download unless data is stale
  (`python data.py --refresh`).
- Keep every tunable in `config.py`; run `python -m pytest` after touching
  `engine.py`, `indicators.py`, or `metrics.py`.
