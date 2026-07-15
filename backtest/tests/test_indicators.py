import pandas as pd
import pytest

from indicators import atr, ema


def test_ema_hand_computed():
    # span=3 -> alpha=0.5, seeded from the first value
    s = pd.Series([1.0, 2.0, 3.0, 4.0])
    out = ema(s, span=3)
    assert out.tolist() == pytest.approx([1.0, 1.5, 2.25, 3.125])


def test_atr_wilder_hand_computed():
    # period=2 -> alpha=0.5. TR0 = high-low; later TRs use prev close.
    df = pd.DataFrame(
        {
            "high": [10.0, 12.0, 11.0],
            "low": [8.0, 9.0, 7.0],
            "close": [9.0, 11.0, 8.0],
        }
    )
    # TR: bar0 = 2; bar1 = max(3, |12-9|=3, |9-9|=0) = 3; bar2 = max(4, |11-11|=0, |7-11|=4) = 4
    # ATR: 2, 0.5*3+0.5*2 = 2.5, 0.5*4+0.5*2.5 = 3.25
    out = atr(df, period=2)
    assert out.tolist() == pytest.approx([2.0, 2.5, 3.25])


def test_atr_positive_on_flat_bars():
    df = pd.DataFrame({"high": [5.0] * 5, "low": [5.0] * 5, "close": [5.0] * 5})
    assert (atr(df, period=3) == 0).all()
