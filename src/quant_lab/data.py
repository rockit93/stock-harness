from __future__ import annotations

from datetime import date
from enum import Enum
from io import StringIO

import pandas as pd
import requests


class Market(str, Enum):
    A_SHARE = "A Share"
    HK = "Hong Kong"
    US = "US"


def _normalize_ohlcv(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame.columns = [str(column).lower().strip().replace(" ", "_") for column in frame.columns]
    required = ["open", "high", "low", "close", "volume"]
    missing = [column for column in required if column not in frame.columns]
    if missing:
        raise RuntimeError(f"Missing required OHLCV columns: {', '.join(missing)}")

    output = frame[required].copy()
    output.index = pd.to_datetime(output.index)
    output = output.sort_index()
    for column in required:
        output[column] = pd.to_numeric(output[column], errors="coerce")
    return output.dropna(subset=["open", "high", "low", "close"])


def _load_a_share(symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
    import akshare as ak

    raw = ak.stock_zh_a_hist(
        symbol=symbol,
        period="daily",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust=adjust,
    )
    if raw.empty:
        raise RuntimeError("AkShare returned no A-share data.")

    rename = {
        "日期": "date",
        "开盘": "open",
        "收盘": "close",
        "最高": "high",
        "最低": "low",
        "成交量": "volume",
    }
    raw = raw.rename(columns=rename)
    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _normalize_ohlcv(raw)


def _filter_dates(frame: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    return frame[(frame.index >= start_ts) & (frame.index <= end_ts)]


def _load_ak_hk_daily(symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
    import akshare as ak

    raw = ak.stock_hk_daily(symbol=symbol.replace(".HK", "").zfill(5), adjust=adjust)
    if raw.empty:
        raise RuntimeError(f"AkShare returned no Hong Kong data for {symbol}.")

    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _filter_dates(_normalize_ohlcv(raw), start, end)


def _load_ak_us_daily(symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
    import akshare as ak

    raw = ak.stock_us_daily(symbol=symbol.upper().replace(".US", ""), adjust=adjust)
    if raw.empty:
        raise RuntimeError(f"AkShare returned no US data for {symbol}.")

    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _filter_dates(_normalize_ohlcv(raw), start, end)


def _load_yfinance(ticker: str, start: date, end: date) -> pd.DataFrame:
    import yfinance as yf

    raw = yf.download(
        ticker,
        start=start.isoformat(),
        end=end.isoformat(),
        auto_adjust=False,
        progress=False,
        group_by="column",
    )
    if raw.empty:
        raise RuntimeError(f"Yahoo Finance returned no data for {ticker}.")

    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)
    return _normalize_ohlcv(raw)


def _load_stooq(ticker: str, start: date, end: date) -> pd.DataFrame:
    url = "https://stooq.com/q/d/l/"
    response = requests.get(
        url,
        params={
            "s": ticker.lower(),
            "d1": start.strftime("%Y%m%d"),
            "d2": end.strftime("%Y%m%d"),
            "i": "d",
        },
        headers={"User-Agent": "local-quant-assistant/0.1"},
        timeout=30,
    )
    response.raise_for_status()
    raw = pd.read_csv(StringIO(response.text))
    if raw.empty or "Date" not in raw.columns:
        raise RuntimeError(f"Stooq returned no data for {ticker}.")

    raw = raw.rename(
        columns={
            "Date": "date",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _normalize_ohlcv(raw)


def _hk_ticker(symbol: str) -> str:
    clean = symbol.upper().replace(".HK", "").strip()
    return f"{clean.zfill(4)}.HK"


def _stooq_ticker(market: Market, symbol: str) -> str:
    clean = symbol.lower().strip()
    if market == Market.HK:
        clean = clean.replace(".hk", "").zfill(4)
        return f"{clean}.hk"
    if market == Market.US:
        clean = clean.replace(".us", "")
        return f"{clean}.us"
    raise ValueError(f"Unsupported Stooq market: {market}")


def load_daily_bars(market: Market, symbol: str, start: date, end: date, adjust: str = "qfq") -> pd.DataFrame:
    if market == Market.A_SHARE:
        return _load_a_share(symbol=symbol.strip(), start=start, end=end, adjust=adjust)
    if market == Market.HK:
        try:
            return _load_ak_hk_daily(symbol, start=start, end=end, adjust=adjust)
        except Exception:
            return _load_yfinance(_hk_ticker(symbol), start=start, end=end)
    if market == Market.US:
        try:
            return _load_ak_us_daily(symbol, start=start, end=end, adjust=adjust)
        except Exception:
            return _load_yfinance(symbol.upper().strip(), start=start, end=end)
    raise ValueError(f"Unsupported market: {market}")
