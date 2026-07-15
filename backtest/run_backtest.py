"""Run the full EMA-crossover grid, write reports, chart the robust pick.

Usage: python run_backtest.py [--refresh]

Outputs (in results/):
  grid_report.csv      every combo x exit mode x split, all metrics
  REPORT.md            readable in-sample vs out-of-sample tables + pick rationale
  equity_curve.png     full-period equity + drawdown for the robust pick
  trades_<combo>.csv   every trade of the robust pick's full-period run
"""

import math
import sys
from datetime import datetime, timezone

import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt

import config
from data import load_data
from engine import run_backtest
from indicators import add_indicators
from metrics import summarize

ENGINE_PARAMS = dict(
    initial_equity=config.INITIAL_EQUITY,
    risk_pct=config.RISK_PCT,
    fee_pct=config.FEE_PCT,
    slippage_pct=config.SLIPPAGE_PCT,
    atr_stop_mult=config.ATR_STOP_MULT,
    tp_r_mult=config.TP_R_MULT,
)

MODE_LABEL = {"tp": "A: fixed 2R take-profit", "cross": "B: opposite crossover"}

# chart chrome (dataviz reference palette, light mode)
INK, INK2, MUTED = "#0b0b0b", "#52514e", "#898781"
GRID, BASELINE, SURFACE = "#e1e0d9", "#c3c2b7", "#fcfcfb"
SERIES_EQ, SERIES_DD = "#2a78d6", "#e34948"


def run_cell(dfi, fast, slow, mode, start, end):
    warmup = max(slow, config.ATR_PERIOD) + 1
    return run_backtest(dfi, mode, warmup_bars=warmup, start=start, end=end, **ENGINE_PARAMS)


def build_grid(df):
    """All combos x exit modes x splits -> (metrics DataFrame, results dict)."""
    last = df.index[-1]
    windows = {"IS": (config.IS_START, config.IS_END), "OOS": (config.OOS_START, last)}
    rows, results = [], {}
    for fast, slow in config.EMA_GRID:
        dfi = add_indicators(df, fast, slow, config.ATR_PERIOD)
        for mode in config.EXIT_MODES:
            for split, (s, e) in windows.items():
                res = run_cell(dfi, fast, slow, mode, s, e)
                results[(fast, slow, mode, split)] = res
                rows.append(
                    {"fast": fast, "slow": slow, "combo": f"{fast}/{slow}", "exit_mode": mode, "split": split}
                    | summarize(res)
                )
    return pd.DataFrame(rows), results


def select_robust(grid):
    """Pick the (combo, exit_mode) with the best neighbor-smoothed IS expectancy.

    The grid is a 1-D ordered list (fastest to slowest); a combo's robustness
    score is the mean in-sample expectancy(R) over itself and its adjacent
    neighbors, so a lucky single cell in a dead neighborhood can't win.
    Combos with fewer than MIN_TRADES_IS in-sample trades are disqualified.
    Selection never looks at out-of-sample numbers. Ties break on
    neighbor-smoothed profit factor (capped at 10 so an inf can't dominate).
    """
    is_rows = grid[grid["split"] == "IS"].set_index(["exit_mode", "combo"])
    combos = [f"{f}/{s}" for f, s in config.EMA_GRID]
    scores = []
    for mode in config.EXIT_MODES:
        for i, combo in enumerate(combos):
            own = is_rows.loc[(mode, combo)]
            neigh = combos[max(i - 1, 0) : i + 2]
            exp = [is_rows.loc[(mode, c), "expectancy_r"] for c in neigh]
            pf = [min(is_rows.loc[(mode, c), "profit_factor"], 10.0) for c in neigh]
            exp = [x for x in exp if not math.isnan(x)]
            pf = [x for x in pf if not math.isnan(x)]
            qualified = own["trades"] >= config.MIN_TRADES_IS and not math.isnan(own["expectancy_r"])
            scores.append(
                {
                    "exit_mode": mode,
                    "combo": combo,
                    "qualified": qualified,
                    "smoothed_expectancy_r": float(np.mean(exp)) if exp else math.nan,
                    "smoothed_profit_factor": float(np.mean(pf)) if pf else math.nan,
                }
            )
    scores = pd.DataFrame(scores)
    ranked = scores[scores["qualified"]].sort_values(
        ["smoothed_expectancy_r", "smoothed_profit_factor"], ascending=False
    )
    if ranked.empty:
        raise SystemExit("no combo met the minimum in-sample trade count; nothing robust to pick")
    best = ranked.iloc[0]
    fast, slow = (int(x) for x in best["combo"].split("/"))
    return (fast, slow, best["exit_mode"]), scores


def plot_equity(res, fast, slow, mode, path):
    eq = res.equity
    dd = eq / eq.cummax() - 1.0

    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(10, 6.2), sharex=True,
        gridspec_kw={"height_ratios": [3, 1], "hspace": 0.08},
    )
    fig.patch.set_facecolor(SURFACE)
    for ax in (ax1, ax2):
        ax.set_facecolor(SURFACE)
        ax.grid(True, color=GRID, linewidth=0.8)
        ax.tick_params(colors=MUTED, labelsize=9)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        for side in ("left", "bottom"):
            ax.spines[side].set_color(BASELINE)

    ax1.plot(eq.index, eq.values, color=SERIES_EQ, linewidth=2)
    if eq.max() / max(eq.min(), 1e-9) > 4:
        ax1.set_yscale("log")
    boundary = pd.Timestamp(config.OOS_START)
    for ax in (ax1, ax2):
        ax.axvline(boundary, color=MUTED, linewidth=1, linestyle=(0, (4, 4)))
    ax1.text(boundary, ax1.get_ylim()[1], " out-of-sample →", color=INK2, fontsize=9, va="top")
    ax1.text(boundary, ax1.get_ylim()[1], "← in-sample ", color=INK2, fontsize=9, va="top", ha="right")
    ax1.set_ylabel("Equity ($)", color=INK2, fontsize=10)
    ax1.set_title(
        f"BTC/USD EMA {fast}/{slow} crossover, exit {MODE_LABEL[mode]} — "
        f"$5,000 start, 1% risk, costs included",
        color=INK, fontsize=11, loc="left", pad=12,
    )

    ax2.fill_between(dd.index, dd.values * 100, 0, color=SERIES_DD, alpha=0.35, linewidth=0)
    ax2.plot(dd.index, dd.values * 100, color=SERIES_DD, linewidth=1.2)
    ax2.set_ylabel("Drawdown (%)", color=INK2, fontsize=10)

    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)


def fmt(m):
    def pct(x):
        return "—" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x * 100:.1f}%"

    def usd(x):
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return "—"
        return f"-${abs(x):,.2f}" if x < 0 else f"${x:,.2f}"

    pf = m["profit_factor"]
    pf_s = "—" if math.isnan(pf) else ("∞" if math.isinf(pf) else f"{pf:.2f}")
    exp = m["expectancy_r"]
    exp_s = "—" if math.isnan(exp) else f"{exp:+.2f}R"
    return {
        "trades": str(m["trades"]),
        "win_rate": pct(m["win_rate"]),
        "avg_win": usd(m["avg_win"]),
        "avg_loss": usd(m["avg_loss"]),
        "expectancy": exp_s,
        "profit_factor": pf_s,
        "max_dd": pct(m["max_drawdown"]),
        "cagr": pct(m["cagr"]),
        "final_eq": usd(m["final_equity"]),
    }


def grid_table(grid, mode, split):
    header = (
        "| EMA | Trades | Win rate | Avg win | Avg loss | Expectancy | PF | Max DD | CAGR | Final equity |\n"
        "|---|---|---|---|---|---|---|---|---|---|\n"
    )
    lines = []
    sel = grid[(grid["exit_mode"] == mode) & (grid["split"] == split)]
    for f, s in config.EMA_GRID:
        m = sel[(sel["fast"] == f) & (sel["slow"] == s)].iloc[0]
        v = fmt(m)
        lines.append(
            f"| {f}/{s} | {v['trades']} | {v['win_rate']} | {v['avg_win']} | {v['avg_loss']} "
            f"| {v['expectancy']} | {v['profit_factor']} | {v['max_dd']} | {v['cagr']} | {v['final_eq']} |"
        )
    return header + "\n".join(lines)


def write_report(grid, scores, pick, full_metrics, df, path):
    fast, slow, mode = pick
    combo = f"{fast}/{slow}"
    oos_end = df.index[-1].date()
    v = fmt(full_metrics)

    score_lines = [
        "| Exit | EMA | Smoothed IS expectancy | Smoothed IS PF | Qualified (≥"
        f"{config.MIN_TRADES_IS} IS trades) |",
        "|---|---|---|---|---|",
    ]
    for _, r in scores.iterrows():
        se = "—" if math.isnan(r["smoothed_expectancy_r"]) else f"{r['smoothed_expectancy_r']:+.2f}R"
        sp = "—" if math.isnan(r["smoothed_profit_factor"]) else f"{r['smoothed_profit_factor']:.2f}"
        marker = " **← pick**" if (r["combo"] == combo and r["exit_mode"] == mode) else ""
        score_lines.append(
            f"| {MODE_LABEL[r['exit_mode']][:1]} | {r['combo']} | {se} | {sp} | {'yes' if r['qualified'] else 'no'}{marker} |"
        )

    sections = [
        "# BTC EMA-Crossover Backtest Report",
        f"Generated {datetime.now(timezone.utc).date()} · data {df.index[0].date()} → {oos_end} "
        f"(Coinbase BTC-USD daily) · ${config.INITIAL_EQUITY:,.0f} start · "
        f"{config.RISK_PCT:.0%} risk/trade · costs {config.FEE_PCT:.1%} fee/side + {config.SLIPPAGE_PCT:.2%} slippage/side",
        "",
        "Long-only. Entry: fast EMA closes above slow EMA → buy next open. "
        f"Stop: {config.ATR_STOP_MULT:g}×ATR({config.ATR_PERIOD}) below entry (=1R). "
        f"Exit A: fixed {config.TP_R_MULT:g}R take-profit. Exit B: opposite crossover (stop stays active). "
        "Same-day stop+target resolves to the stop (pessimistic). Position sizes risk "
        f"{config.RISK_PCT:.0%} of current equity, notional capped at 100% equity (no leverage). "
        f"Each split runs independently from ${config.INITIAL_EQUITY:,.0f}. "
        "All metrics are net of fees and slippage.",
        "",
        f"## Exit {MODE_LABEL['tp']}",
        f"### In-sample ({config.IS_START} → {config.IS_END})",
        grid_table(grid, "tp", "IS"),
        f"### Out-of-sample ({config.OOS_START} → {oos_end})",
        grid_table(grid, "tp", "OOS"),
        "",
        f"## Exit {MODE_LABEL['cross']}",
        f"### In-sample ({config.IS_START} → {config.IS_END})",
        grid_table(grid, "cross", "IS"),
        f"### Out-of-sample ({config.OOS_START} → {oos_end})",
        grid_table(grid, "cross", "OOS"),
        "",
        "## Robustness selection",
        "Score = mean in-sample expectancy(R) over the combo **and its grid neighbors** "
        "(the grid is ordered fastest→slowest), so an isolated lucky cell can't win. "
        "Out-of-sample numbers are never used for selection — they are validation only. "
        "Ties break on neighbor-smoothed profit factor (capped at 10).",
        "",
        "\n".join(score_lines),
        "",
        f"**Pick: EMA {combo}, exit {MODE_LABEL[mode]}.**",
        "",
        f"## Full-period run of the pick ({df.index[0].date()} → {oos_end}, continuous)",
        f"Trades {v['trades']} · win rate {v['win_rate']} · avg win {v['avg_win']} · "
        f"avg loss {v['avg_loss']} · expectancy {v['expectancy']} · PF {v['profit_factor']} · "
        f"max DD {v['max_dd']} · CAGR {v['cagr']} · final equity {v['final_eq']}",
        "",
        f"Artifacts: `equity_curve.png`, `trades_{fast}_{slow}_{mode}.csv`.",
        "",
        "## Caveats",
        "- Research only — this is not investment advice and places no orders.",
        "- Five preset EMA pairs on one asset and one bar size; neighbor-smoothing reduces but "
        "does not eliminate selection bias.",
        "- Daily bars can't see intrabar path: same-day stop+target is resolved pessimistically "
        "to the stop, and gaps through a level fill at the open.",
        "- In-sample results before the slow EMA warms up (~slow-period bars from 2019-01-01) "
        "produce no signals by construction.",
        "- Fills assume the quoted costs; real spreads/slippage vary with size and volatility.",
    ]
    path.write_text("\n".join(sections) + "\n")


def trades_frame(res):
    rows = []
    equity_after = res.initial_equity
    for t in res.trades:
        equity_after += t.pnl
        rows.append(
            {
                "entry_date": t.entry_date.date(),
                "entry_price": round(t.entry_price, 2),
                "units": round(t.units, 8),
                "stop": round(t.stop, 2),
                "target": round(t.target, 2) if t.target is not None else "",
                "risk_per_unit": round(t.risk_per_unit, 2),
                "notional_capped": t.notional_capped,
                "exit_date": t.exit_date.date(),
                "exit_price": round(t.exit_price, 2),
                "exit_reason": t.exit_reason,
                "fees": round(t.entry_fee + t.exit_fee, 2),
                "pnl": round(t.pnl, 2),
                "r_multiple": round(t.r_multiple, 3),
                "equity_after": round(equity_after, 2),
            }
        )
    return pd.DataFrame(rows)


def main():
    df = load_data(refresh="--refresh" in sys.argv)
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    grid, _ = build_grid(df)
    grid_out = grid.drop(columns=["fast", "slow"])
    grid_out.to_csv(config.RESULTS_DIR / "grid_report.csv", index=False, float_format="%.6g")

    (fast, slow, mode), scores = select_robust(grid)
    print(f"robust pick: EMA {fast}/{slow}, exit mode {mode!r}")

    dfi = add_indicators(df, fast, slow, config.ATR_PERIOD)
    full = run_cell(dfi, fast, slow, mode, df.index[0], df.index[-1])
    full_metrics = summarize(full)

    plot_equity(full, fast, slow, mode, config.RESULTS_DIR / "equity_curve.png")
    trades_frame(full).to_csv(config.RESULTS_DIR / f"trades_{fast}_{slow}_{mode}.csv", index=False)
    write_report(grid, scores, (fast, slow, mode), full_metrics, df, config.RESULTS_DIR / "REPORT.md")

    print(f"wrote {config.RESULTS_DIR / 'grid_report.csv'}")
    print(f"wrote {config.RESULTS_DIR / 'REPORT.md'}")
    print(f"wrote {config.RESULTS_DIR / 'equity_curve.png'}")
    print(f"wrote {config.RESULTS_DIR / f'trades_{fast}_{slow}_{mode}.csv'}")


if __name__ == "__main__":
    main()
