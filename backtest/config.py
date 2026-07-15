"""Central configuration for the BTC EMA-crossover backtest.

Every tunable lives here so a grid change or cost assumption never hides
inside strategy code.
"""

from pathlib import Path

# --- Data ---------------------------------------------------------------
SYMBOL = "BTC-USD"
DATA_START = "2019-01-01"          # first daily candle requested
DATA_DIR = Path(__file__).parent / "data"
DATA_CSV = DATA_DIR / "btc_usd_daily.csv"

# --- Splits -------------------------------------------------------------
IS_START = "2019-01-01"            # in-sample window (inclusive)
IS_END = "2023-12-31"
OOS_START = "2024-01-01"           # out-of-sample runs to last cached bar

# --- Strategy grid ------------------------------------------------------
EMA_GRID = [(9, 21), (12, 26), (20, 50), (50, 100), (50, 200)]
ATR_PERIOD = 14
ATR_STOP_MULT = 2.0                # stop = entry - 2*ATR(14); this distance is 1R
TP_R_MULT = 2.0                    # exit mode A: fixed take-profit at +2R
EXIT_MODES = ("tp", "cross")       # A = "tp", B = "cross" (opposite crossover)

# --- Account / costs ----------------------------------------------------
INITIAL_EQUITY = 5_000.0
RISK_PCT = 0.01                    # risk 1% of current equity per trade
FEE_PCT = 0.001                    # 0.1% taker fee per side
SLIPPAGE_PCT = 0.0005              # 0.05% adverse slippage per side

# --- Robustness selection ------------------------------------------------
MIN_TRADES_IS = 15                 # combos with fewer in-sample trades are disqualified

# --- Outputs --------------------------------------------------------------
RESULTS_DIR = Path(__file__).parent / "results"
