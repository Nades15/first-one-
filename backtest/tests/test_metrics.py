import math
from types import SimpleNamespace

import pandas as pd
import pytest

from metrics import summarize


def fake_result(pnls, rs, equity_vals, dates, initial=100.0):
    trades = [SimpleNamespace(pnl=p, r_multiple=r) for p, r in zip(pnls, rs)]
    equity = pd.Series(equity_vals, index=pd.to_datetime(dates))
    return SimpleNamespace(trades=trades, equity=equity, initial_equity=initial)


def test_summarize_known_values():
    res = fake_result(
        pnls=[100.0, -50.0, 50.0, -100.0],
        rs=[1.0, -0.5, 0.5, -1.0],
        equity_vals=[100.0, 120.0, 90.0, 130.0],
        dates=["2019-01-01", "2019-06-01", "2019-10-01", "2020-01-01"],
    )
    m = summarize(res)
    assert m["trades"] == 4
    assert m["win_rate"] == pytest.approx(0.5)
    assert m["avg_win"] == pytest.approx(75.0)
    assert m["avg_loss"] == pytest.approx(-75.0)
    assert m["expectancy_r"] == pytest.approx(0.0)
    assert m["profit_factor"] == pytest.approx(1.0)
    assert m["max_drawdown"] == pytest.approx(-0.25)  # 120 -> 90
    # 100 -> 130 over exactly 365 days
    assert m["cagr"] == pytest.approx(1.3 ** (365.25 / 365) - 1)
    assert m["final_equity"] == pytest.approx(130.0)
    assert m["total_return"] == pytest.approx(0.30)


def test_summarize_all_winners_has_inf_profit_factor():
    res = fake_result([10.0, 20.0], [1.0, 2.0], [100.0, 130.0], ["2019-01-01", "2019-12-31"])
    m = summarize(res)
    assert math.isinf(m["profit_factor"])
    assert math.isnan(m["avg_loss"])


def test_summarize_no_trades():
    res = fake_result([], [], [100.0, 100.0], ["2019-01-01", "2019-12-31"])
    m = summarize(res)
    assert m["trades"] == 0
    assert math.isnan(m["win_rate"])
    assert math.isnan(m["expectancy_r"])
    assert m["max_drawdown"] == 0.0
