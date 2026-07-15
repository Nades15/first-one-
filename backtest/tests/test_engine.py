import pandas as pd
import pytest

from engine import run_backtest

P = dict(
    initial_equity=5000.0,
    risk_pct=0.01,
    fee_pct=0.001,
    slippage_pct=0.0005,
    atr_stop_mult=2.0,
    tp_r_mult=2.0,
    warmup_bars=1,
)

FEE = P["fee_pct"]
SLIP = P["slippage_pct"]


def make_df(rows, start="2020-01-01"):
    """rows: list of (o, h, l, c, ema_fast, ema_slow, atr) tuples."""
    idx = pd.date_range(start, periods=len(rows), freq="D")
    cols = ["open", "high", "low", "close", "ema_fast", "ema_slow", "atr"]
    return pd.DataFrame([dict(zip(cols, r)) for r in rows], index=idx)


def base_rows():
    """Bar 0 flat (fast below slow), bar 1 cross-up, bar 2 entry day (benign)."""
    return [
        (100, 101, 99, 100, 99, 100, 5),   # 0: no signal
        (100, 101, 99, 100, 101, 100, 5),  # 1: cross-up on close -> ATR 5 => 1R = 10
        (100, 105, 95, 102, 102, 100, 5),  # 2: entry at open; stop 90.05 / target 120.05 untouched
    ]


def entry_expectations():
    entry_fill = 100 * (1 + SLIP)          # 100.05
    units = 0.01 * 5000 / 10.0             # risk 1% of 5000 over 1R=10 -> 5 units
    return entry_fill, units


def test_entry_next_open_with_sizing_and_stop_levels():
    df = make_df(base_rows())
    res = run_backtest(df, "tp", **P)
    assert len(res.trades) == 1
    t = res.trades[0]
    entry_fill, units = entry_expectations()
    assert t.entry_date == df.index[2]
    assert t.entry_price == pytest.approx(entry_fill)
    assert t.units == pytest.approx(units)
    assert t.stop == pytest.approx(entry_fill - 10)
    assert t.target == pytest.approx(entry_fill + 20)
    assert t.risk_per_unit == pytest.approx(10)
    assert not t.notional_capped
    # forced flat at end of data
    assert t.exit_reason == "end_of_data"
    assert t.exit_price == pytest.approx(102 * (1 - SLIP))


def test_no_trade_when_signal_on_last_bar():
    df = make_df(base_rows()[:2])  # cross-up happens on the final bar
    res = run_backtest(df, "tp", **P)
    assert res.trades == []
    assert res.final_equity == P["initial_equity"]


def test_stop_fill_and_accounting():
    rows = base_rows() + [(95, 96, 89, 92, 101.5, 100, 5)]  # low pierces stop 90.05
    res = run_backtest(make_df(rows), "tp", **P)
    t = res.trades[0]
    entry_fill, units = entry_expectations()
    stop = entry_fill - 10
    exit_fill = stop * (1 - SLIP)
    assert t.exit_reason == "stop"
    assert t.exit_date == res.equity.index[3]
    assert t.exit_price == pytest.approx(exit_fill)
    expected_pnl = units * (exit_fill - entry_fill) - units * entry_fill * FEE - units * exit_fill * FEE
    assert t.pnl == pytest.approx(expected_pnl)
    # a full stop-out is ~ -1R, slightly worse due to fees/slippage
    assert t.r_multiple == pytest.approx(expected_pnl / (units * 10))
    assert -1.1 < t.r_multiple < -1.0
    # cash accounting closes the loop: final equity = initial + trade pnl
    assert res.final_equity == pytest.approx(P["initial_equity"] + t.pnl)


def test_gap_through_stop_fills_at_open():
    rows = base_rows() + [(88, 92, 85, 90, 101.5, 100, 5)]  # opens below stop 90.05
    res = run_backtest(make_df(rows), "tp", **P)
    t = res.trades[0]
    assert t.exit_reason == "stop_gap"
    assert t.exit_price == pytest.approx(88 * (1 - SLIP))
    assert t.r_multiple < -1.0  # gap fill is worse than the stop


def test_target_fill_is_about_plus_2r():
    rows = base_rows() + [(110, 121, 105, 118, 103, 100, 5)]  # high pierces target 120.05
    res = run_backtest(make_df(rows), "tp", **P)
    t = res.trades[0]
    entry_fill, units = entry_expectations()
    assert t.exit_reason == "target"
    assert t.exit_price == pytest.approx((entry_fill + 20) * (1 - SLIP))
    assert 1.9 < t.r_multiple < 2.0  # +2R minus costs


def test_same_day_stop_and_target_resolves_to_stop():
    rows = base_rows() + [(100, 125, 89, 110, 103, 100, 5)]  # touches both levels
    res = run_backtest(make_df(rows), "tp", **P)
    assert res.trades[0].exit_reason == "stop"


def test_cross_mode_exits_at_next_open_and_has_no_target():
    rows = base_rows() + [
        (101, 102, 98, 99, 99, 100, 5),   # 3: cross-down on close (stop 90.05 untouched)
        (98, 99, 96, 97, 98, 100, 5),     # 4: exit at open
    ]
    res = run_backtest(make_df(rows), "cross", **P)
    t = res.trades[0]
    assert t.target is None
    assert t.exit_reason == "cross_exit"
    assert t.exit_date == res.equity.index[4]
    assert t.exit_price == pytest.approx(98 * (1 - SLIP))


def test_cross_mode_ignores_target_prices():
    rows = base_rows() + [(110, 130, 105, 125, 104, 100, 5)]  # would be a 2R target hit
    res = run_backtest(make_df(rows), "cross", **P)
    assert res.trades[0].exit_reason == "end_of_data"


def test_stop_still_active_while_waiting_for_cross_exit():
    rows = base_rows() + [(95, 96, 89, 92, 101.5, 100, 5)]
    res = run_backtest(make_df(rows), "cross", **P)
    assert res.trades[0].exit_reason == "stop"


def test_notional_cap_prevents_leverage():
    rows = [
        (100, 101, 99, 100, 99, 100, 0.05),   # tiny ATR -> uncapped size would be huge
        (100, 101, 99, 100, 101, 100, 0.05),
        (100, 105, 99.96, 102, 102, 100, 0.05),
    ]
    res = run_backtest(make_df(rows), "tp", **P)
    t = res.trades[0]
    entry_fill = 100 * (1 + SLIP)
    assert t.notional_capped
    assert t.units == pytest.approx(5000 / (entry_fill * (1 + FEE)))
    assert t.units * entry_fill * (1 + FEE) <= 5000 * (1 + 1e-9)


def test_reentry_requires_fresh_crossover():
    # After the stop-out, fast stays above slow: no new cross, so no re-entry.
    rows = base_rows() + [
        (95, 96, 89, 92, 101.5, 100, 5),      # stop-out
        (95, 97, 94, 96, 101.5, 100, 5),
        (96, 98, 95, 97, 101.8, 100, 5),
    ]
    res = run_backtest(make_df(rows), "tp", **P)
    assert len(res.trades) == 1


def test_signal_on_bar_before_window_start_is_actionable():
    df = make_df(base_rows())
    res = run_backtest(df, "tp", **P, start=df.index[2], end=df.index[2])
    assert len(res.trades) == 1
    assert res.trades[0].entry_date == df.index[2]
    assert len(res.equity) == 1


def test_no_lookahead_future_bars_cannot_change_past_trades():
    rows = base_rows() + [
        (95, 96, 89, 92, 101.5, 100, 5),      # stop-out on bar 3
        (95, 97, 94, 96, 99, 100, 5),
        (96, 98, 95, 97, 98, 100, 5),
    ]
    df_a = make_df(rows)
    df_b = df_a.copy()
    # rewrite the future (bars 4-5): prices and indicators changed wildly
    df_b.iloc[4:, :] = [[500, 600, 400, 550, 999, 1, 50], [50, 60, 40, 55, 1, 999, 50]]
    ta = run_backtest(df_a, "tp", **P).trades[0]
    tb = run_backtest(df_b, "tp", **P).trades[0]
    assert (ta.entry_date, ta.entry_price, ta.exit_date, ta.exit_price, ta.exit_reason) == (
        tb.entry_date, tb.entry_price, tb.exit_date, tb.exit_price, tb.exit_reason
    )


def test_equity_is_marked_to_market_daily():
    # extra benign bar so bar 2 is not the final (force-close) bar
    df = make_df(base_rows() + [(102, 104, 100, 103, 102, 100, 5)])
    res = run_backtest(df, "tp", **P)
    _, units = entry_expectations()
    cash_after_entry = 5000 - units * 100.05 - units * 100.05 * FEE
    # bar 2 closes at 102 with the position still open
    assert res.equity.iloc[2] == pytest.approx(cash_after_entry + units * 102, rel=1e-9)


def test_risk_uses_current_equity_not_initial():
    # First trade loses; the second trade must size off the reduced equity.
    rows = base_rows() + [
        (95, 96, 89, 92, 99, 100, 5),          # 3: stop-out AND cross-down state
        (95, 97, 94, 96, 98, 100, 5),          # 4: still below
        (96, 98, 95, 97, 101, 100, 4),         # 5: cross-up again, ATR 4 -> 1R = 8
        (97, 99, 96, 98, 101.5, 100, 4),       # 6: second entry at open
    ]
    res = run_backtest(make_df(rows), "tp", **P)
    assert len(res.trades) == 2
    first, second = res.trades
    eq_after_first = 5000 + first.pnl
    assert second.units == pytest.approx(0.01 * eq_after_first / 8.0)
