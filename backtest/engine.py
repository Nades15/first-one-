"""Event-loop backtest engine for the long-only EMA-crossover strategy.

The engine is strictly causal: signals are read from bar t's close and can
only produce fills at bar t+1's open (or later via resting stop/target
orders). It consumes a DataFrame that already carries indicator columns
(ema_fast, ema_slow, atr) so tests can inject exact indicator values.

Fill model (per in-position day, checked in this order):
  1. pending opposite-cross exit (mode "cross") fills at the open
  2. gap through the stop fills at the open (worse than the stop)
  3. stop touched intraday fills at the stop
  4. mode "tp" only: gap through the target fills at the open (better),
     otherwise target touched intraday fills at the target
If both stop and target are touched on the same bar, the stop is assumed
to fill first (pessimistic).

Costs: buys fill at price*(1+slippage), sells at price*(1-slippage), and a
proportional fee is charged on the fill notional of each side.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class Trade:
    entry_date: pd.Timestamp
    entry_price: float          # actual fill, slippage included
    units: float
    stop: float
    target: float | None        # None in "cross" exit mode
    risk_per_unit: float        # 2*ATR at signal time = 1R in price terms
    entry_fee: float
    notional_capped: bool
    exit_date: pd.Timestamp | None = None
    exit_price: float | None = None
    exit_fee: float = 0.0
    exit_reason: str | None = None
    pnl: float | None = None    # net of both fees, slippage embedded in fills
    r_multiple: float | None = None


@dataclass
class BacktestResult:
    trades: list
    equity: pd.Series           # daily mark-to-market equity (close marks)
    initial_equity: float

    @property
    def final_equity(self) -> float:
        return float(self.equity.iloc[-1]) if len(self.equity) else self.initial_equity


def run_backtest(
    df: pd.DataFrame,
    exit_mode: str,
    *,
    initial_equity: float,
    risk_pct: float,
    fee_pct: float,
    slippage_pct: float,
    atr_stop_mult: float,
    tp_r_mult: float,
    warmup_bars: int,
    start=None,
    end=None,
) -> BacktestResult:
    """Run one strategy configuration over df[start:end].

    df must be indexed by ascending dates with columns open/high/low/close
    and precomputed ema_fast/ema_slow/atr over the FULL history, so a window
    starting mid-series uses warmed-up indicators. warmup_bars gates signal
    generation (no entries before indicators are meaningful).
    """
    if exit_mode not in ("tp", "cross"):
        raise ValueError(f"unknown exit_mode {exit_mode!r}")

    dates = df.index
    o = df["open"].to_numpy(dtype=float)
    h = df["high"].to_numpy(dtype=float)
    l = df["low"].to_numpy(dtype=float)
    c = df["close"].to_numpy(dtype=float)
    ef = df["ema_fast"].to_numpy(dtype=float)
    es = df["ema_slow"].to_numpy(dtype=float)
    atr = df["atr"].to_numpy(dtype=float)

    n = len(df)
    start_i = int(dates.searchsorted(pd.Timestamp(start), side="left")) if start else 0
    end_i = (int(dates.searchsorted(pd.Timestamp(end), side="right")) - 1) if end else n - 1
    if start_i > end_i:
        return BacktestResult([], pd.Series(dtype=float), initial_equity)

    def cross_up(i):
        return (
            i >= max(warmup_bars, 1)
            and np.isfinite(atr[i]) and atr[i] > 0
            and ef[i] > es[i] and ef[i - 1] <= es[i - 1]
        )

    def cross_down(i):
        return i >= 1 and ef[i] < es[i] and ef[i - 1] >= es[i - 1]

    cash = initial_equity
    trades: list[Trade] = []
    open_trade: Trade | None = None
    pending_entry_atr: float | None = None
    pending_exit = False

    def close_position(i, fill_raw, reason, at_date=None):
        nonlocal cash, open_trade
        t = open_trade
        fill = fill_raw * (1.0 - slippage_pct)
        fee = t.units * fill * fee_pct
        cash += t.units * fill - fee
        t.exit_date = at_date if at_date is not None else dates[i]
        t.exit_price = fill
        t.exit_fee = fee
        t.exit_reason = reason
        t.pnl = t.units * (fill - t.entry_price) - t.entry_fee - fee
        t.r_multiple = t.pnl / (t.units * t.risk_per_unit)
        trades.append(t)
        open_trade = None

    # A crossover on the bar just before the window is actionable at the
    # window's first open (live trading would act on yesterday's signal).
    if cross_up(start_i - 1):
        pending_entry_atr = atr[start_i - 1]

    eq_vals = np.empty(end_i - start_i + 1)

    for i in range(start_i, end_i + 1):
        # 1. pending opposite-cross exit fills at the open
        if open_trade is not None and pending_exit:
            close_position(i, o[i], "cross_exit")
        pending_exit = False

        # 2. pending entry fills at the open
        if open_trade is None and pending_entry_atr is not None:
            entry_fill = o[i] * (1.0 + slippage_pct)
            risk_per_unit = atr_stop_mult * pending_entry_atr
            units = (risk_pct * cash) / risk_per_unit
            capped = False
            if units * entry_fill * (1.0 + fee_pct) > cash:
                units = cash / (entry_fill * (1.0 + fee_pct))
                capped = True
            entry_fee = units * entry_fill * fee_pct
            cash -= units * entry_fill + entry_fee
            open_trade = Trade(
                entry_date=dates[i],
                entry_price=entry_fill,
                units=units,
                stop=entry_fill - risk_per_unit,
                target=(entry_fill + tp_r_mult * risk_per_unit) if exit_mode == "tp" else None,
                risk_per_unit=risk_per_unit,
                entry_fee=entry_fee,
                notional_capped=capped,
            )
        pending_entry_atr = None

        # 3. resting stop/target orders (also live on the entry bar itself)
        if open_trade is not None:
            t = open_trade
            if o[i] <= t.stop:
                close_position(i, o[i], "stop_gap")
            elif l[i] <= t.stop:
                close_position(i, t.stop, "stop")
            elif exit_mode == "tp":
                if o[i] >= t.target:
                    close_position(i, o[i], "target_gap")
                elif h[i] >= t.target:
                    close_position(i, t.target, "target")

        # 4. signals on this close, actionable at the next bar's open
        if i + 1 <= end_i:
            if open_trade is None and cross_up(i):
                pending_entry_atr = atr[i]
            elif open_trade is not None and exit_mode == "cross" and cross_down(i):
                pending_exit = True

        # 5. mark to market on the close
        eq_vals[i - start_i] = cash + (open_trade.units * c[i] if open_trade else 0.0)

    if open_trade is not None:
        close_position(end_i, c[end_i], "end_of_data")
        eq_vals[-1] = cash

    equity = pd.Series(eq_vals, index=dates[start_i : end_i + 1], name="equity")
    return BacktestResult(trades, equity, initial_equity)
