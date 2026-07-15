"""End-to-end smoke test on synthetic data — no network, no real CSV."""

import numpy as np
import pandas as pd
import pytest

import config
import run_backtest as rb
from indicators import add_indicators
from metrics import summarize


@pytest.fixture
def synthetic_df():
    rng = np.random.default_rng(7)
    n = 400
    close = 100 * np.exp(np.cumsum(rng.normal(0.001, 0.03, n)))
    open_ = np.concatenate([[100.0], close[:-1]]) * (1 + rng.normal(0, 0.005, n))
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.02, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.02, n))
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close,
         "volume": rng.uniform(100, 1000, n)},
        index=pd.date_range("2021-01-01", periods=n, freq="D"),
    )


@pytest.fixture
def small_config(monkeypatch, synthetic_df):
    monkeypatch.setattr(config, "EMA_GRID", [(3, 8), (5, 13), (8, 21)])
    monkeypatch.setattr(config, "IS_START", "2021-01-01")
    monkeypatch.setattr(config, "IS_END", "2021-09-30")
    monkeypatch.setattr(config, "OOS_START", "2021-10-01")
    monkeypatch.setattr(config, "MIN_TRADES_IS", 1)


def test_pipeline_end_to_end(synthetic_df, small_config, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "RESULTS_DIR", tmp_path)

    grid, results = rb.build_grid(synthetic_df)
    assert len(grid) == 3 * 2 * 2  # combos x exit modes x splits
    assert set(grid["split"]) == {"IS", "OOS"}

    (fast, slow, mode), scores = rb.select_robust(grid)
    assert (fast, slow) in config.EMA_GRID
    assert mode in config.EXIT_MODES
    assert len(scores) == 3 * 2

    dfi = add_indicators(synthetic_df, fast, slow, config.ATR_PERIOD)
    full = rb.run_cell(dfi, fast, slow, mode, synthetic_df.index[0], synthetic_df.index[-1])
    rb.plot_equity(full, fast, slow, mode, tmp_path / "equity_curve.png")
    rb.write_report(grid, scores, (fast, slow, mode), summarize(full), synthetic_df, tmp_path / "REPORT.md")
    trades = rb.trades_frame(full)

    assert (tmp_path / "equity_curve.png").stat().st_size > 10_000
    report = (tmp_path / "REPORT.md").read_text()
    assert "Robustness selection" in report and f"{fast}/{slow}" in report
    if len(trades):
        # cash accounting closes the loop across the whole run
        assert trades["equity_after"].iloc[-1] == pytest.approx(full.final_equity, abs=0.02)


def test_splits_do_not_overlap(synthetic_df, small_config):
    grid, results = rb.build_grid(synthetic_df)
    is_end = pd.Timestamp(config.IS_END)
    oos_start = pd.Timestamp(config.OOS_START)
    for (f, s, mode, split), res in results.items():
        for t in res.trades:
            if split == "IS":
                assert t.entry_date <= is_end and t.exit_date <= is_end
            else:
                assert t.entry_date >= oos_start
