"""Technical indicators used by the backtest. Pure pandas, no state."""

import pandas as pd


def ema(close: pd.Series, span: int) -> pd.Series:
    """Standard EMA with alpha = 2/(span+1), seeded from the first value."""
    return close.ewm(span=span, adjust=False).mean()


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Wilder-smoothed Average True Range.

    True range uses the previous close; the first bar falls back to
    high - low. Wilder smoothing is an EMA with alpha = 1/period.
    """
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / period, adjust=False).mean()


def add_indicators(df: pd.DataFrame, fast: int, slow: int, atr_period: int) -> pd.DataFrame:
    """Return a copy of df with ema_fast / ema_slow / atr columns attached."""
    out = df.copy()
    out["ema_fast"] = ema(out["close"], fast)
    out["ema_slow"] = ema(out["close"], slow)
    out["atr"] = atr(out, atr_period)
    return out
