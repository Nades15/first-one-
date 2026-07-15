"""BTC/USD daily OHLCV: download from a free public source, cache to CSV.

Primary source is the Coinbase Exchange public candles endpoint (no API key,
300 candles per request, paginated). Fallback is Yahoo Finance's chart API
(single request). Once downloaded, data is cached at config.DATA_CSV and
reruns never touch the network unless --refresh is passed.
"""

import sys
import time
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import requests

import config

COINBASE_URL = "https://api.exchange.coinbase.com/products/{product}/candles"
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
UA = {"User-Agent": "Mozilla/5.0 (research backtest; single daily download)"}


def _get(url, params, retries=4):
    for attempt in range(retries + 1):
        resp = requests.get(url, params=params, headers=UA, timeout=30)
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < retries:
            time.sleep(2 ** attempt)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("unreachable")


def fetch_coinbase(start: date, product: str = "BTC-USD") -> pd.DataFrame:
    """Paginate daily candles [start, yesterday] from Coinbase Exchange."""
    today_utc = datetime.now(timezone.utc).date()
    rows = {}
    chunk_start = start
    while chunk_start < today_utc:
        chunk_end = min(chunk_start + timedelta(days=299), today_utc)
        candles = _get(
            COINBASE_URL.format(product=product),
            {
                "granularity": 86400,
                "start": f"{chunk_start}T00:00:00Z",
                "end": f"{chunk_end}T00:00:00Z",
            },
        )
        for ts, low, high, open_, close, volume in candles:
            d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
            rows[d] = (open_, high, low, close, volume)
        chunk_start = chunk_end + timedelta(days=1)
        time.sleep(0.3)  # stay well under the public rate limit
    df = pd.DataFrame.from_dict(
        rows, orient="index", columns=["open", "high", "low", "close", "volume"]
    )
    df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    return df[df.index.date < today_utc]  # drop today's incomplete candle


def fetch_yahoo(start: date, symbol: str = "BTC-USD") -> pd.DataFrame:
    period1 = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
    period2 = int(datetime.now(timezone.utc).timestamp())
    data = _get(
        YAHOO_URL.format(symbol=symbol),
        {"period1": period1, "period2": period2, "interval": "1d"},
    )
    result = data["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    df = pd.DataFrame(
        {
            "open": quote["open"],
            "high": quote["high"],
            "low": quote["low"],
            "close": quote["close"],
            "volume": quote["volume"],
        },
        index=pd.to_datetime(result["timestamp"], unit="s", utc=True).tz_localize(None).normalize(),
    ).dropna()
    today_utc = datetime.now(timezone.utc).date()
    return df[df.index.date < today_utc].sort_index()


def validate(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        raise ValueError("no data downloaded")
    if df.index.has_duplicates or not df.index.is_monotonic_increasing:
        df = df[~df.index.duplicated(keep="last")].sort_index()
    if (df[["open", "high", "low", "close"]] <= 0).any().any():
        raise ValueError("non-positive prices in data")
    bad_hl = (df["high"] < df[["open", "close"]].max(axis=1)) | (
        df["low"] > df[["open", "close"]].min(axis=1)
    )
    if bad_hl.any():
        print(f"warning: repairing {int(bad_hl.sum())} rows with inconsistent high/low")
        df["high"] = df[["high", "open", "close"]].max(axis=1)
        df["low"] = df[["low", "open", "close"]].min(axis=1)
    full_range = pd.date_range(df.index[0], df.index[-1], freq="D")
    missing = len(full_range) - len(df)
    if missing:
        print(f"warning: {missing} missing calendar day(s) between {df.index[0].date()} and {df.index[-1].date()}")
    age = (datetime.now(timezone.utc).date() - df.index[-1].date()).days
    if age > 3:
        print(f"warning: last bar is {age} days old ({df.index[-1].date()})")
    return df


def load_data(refresh: bool = False) -> pd.DataFrame:
    """Load daily OHLCV from the CSV cache; download only if absent/refresh."""
    if config.DATA_CSV.exists() and not refresh:
        df = pd.read_csv(config.DATA_CSV, index_col="date", parse_dates=True)
        return validate(df)

    start = date.fromisoformat(config.DATA_START)
    try:
        print("downloading from Coinbase Exchange...")
        df = fetch_coinbase(start)
    except Exception as e:
        print(f"Coinbase download failed ({e}); falling back to Yahoo Finance...")
        df = fetch_yahoo(start)
    df = validate(df)
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.DATA_CSV, index_label="date", float_format="%.8g")
    print(f"cached {len(df)} bars ({df.index[0].date()} to {df.index[-1].date()}) -> {config.DATA_CSV}")
    return df


if __name__ == "__main__":
    load_data(refresh="--refresh" in sys.argv)
