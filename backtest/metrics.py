"""Performance metrics computed from a BacktestResult."""

import math

import numpy as np


def summarize(result) -> dict:
    """Return the standard metric set for one backtest run.

    Metrics are computed net of costs (fees/slippage are already embedded
    in trade PnL and the equity curve). Max drawdown uses the daily
    mark-to-market equity, so open-trade excursions count.
    """
    trades = result.trades
    pnls = np.array([t.pnl for t in trades], dtype=float)
    rs = np.array([t.r_multiple for t in trades], dtype=float)
    wins = pnls[pnls > 0]
    losses = pnls[pnls <= 0]

    n = len(trades)
    gross_win = float(wins.sum())
    gross_loss = float(-losses.sum())

    if len(result.equity):
        eq = result.equity.to_numpy()
        max_dd = float((eq / np.maximum.accumulate(eq) - 1.0).min())
        days = max((result.equity.index[-1] - result.equity.index[0]).days, 1)
        final_eq = float(eq[-1])
        cagr = (final_eq / result.initial_equity) ** (365.25 / days) - 1.0
    else:
        max_dd, cagr, final_eq = 0.0, 0.0, result.initial_equity

    return {
        "trades": n,
        "win_rate": len(wins) / n if n else math.nan,
        "avg_win": float(wins.mean()) if len(wins) else math.nan,
        "avg_loss": float(losses.mean()) if len(losses) else math.nan,
        "expectancy_r": float(rs.mean()) if n else math.nan,
        "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else math.inf if gross_win > 0 else math.nan,
        "max_drawdown": max_dd,
        "cagr": cagr,
        "final_equity": final_eq,
        "total_return": final_eq / result.initial_equity - 1.0,
    }
