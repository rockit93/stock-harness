from __future__ import annotations

from datetime import date
from enum import Enum

import pandas as pd


class Market(str, Enum):
    A_SHARE = "A Share"
    HK = "Hong Kong"
    US = "US"


class DataSource(str, Enum):
    AUTO = "auto"
    FUTU = "futu"


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


def _filter_dates(frame: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)
    return frame[(frame.index >= start_ts) & (frame.index <= end_ts)]


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

    raw = raw.rename(
        columns={
            "日期": "date",
            "开盘": "open",
            "收盘": "close",
            "最高": "high",
            "最低": "low",
            "成交量": "volume",
        }
    )
    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _normalize_ohlcv(raw)


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


def _hk_ticker(symbol: str) -> str:
    clean = symbol.upper().replace(".HK", "").strip()
    return f"{clean.zfill(4)}.HK"


def _a_share_futu_code(symbol: str) -> str:
    clean = symbol.upper().replace("SH.", "").replace("SZ.", "").strip()
    if clean.startswith(("5", "6", "9")):
        return f"SH.{clean}"
    return f"SZ.{clean}"


def _futu_code(market: Market, symbol: str) -> str:
    clean = symbol.upper().strip()
    if market == Market.A_SHARE:
        return _a_share_futu_code(clean)
    if market == Market.HK:
        return f"HK.{clean.replace('HK.', '').replace('.HK', '').zfill(5)}"
    if market == Market.US:
        return f"US.{clean.replace('US.', '').replace('.US', '')}"
    raise ValueError(f"Unsupported market for Futu: {market}")


def _futu_adjust(adjust: str):
    from futu import AuType

    if adjust == "qfq":
        return AuType.QFQ
    if adjust == "hfq":
        return AuType.HFQ
    return AuType.NONE


def _load_futu_daily(
    market: Market,
    symbol: str,
    start: date,
    end: date,
    adjust: str,
    host: str,
    port: int,
) -> pd.DataFrame:
    try:
        from futu import KLType, OpenQuoteContext, RET_OK
    except ImportError as exc:
        raise RuntimeError("未安装 futu-api。请运行 pip install futu-api 后重试。") from exc

    quote_ctx = OpenQuoteContext(host=host, port=port)
    code = _futu_code(market, symbol)
    frames = []
    page_req_key = None

    try:
        while True:
            ret, data, page_req_key = quote_ctx.request_history_kline(
                code=code,
                start=start.isoformat(),
                end=end.isoformat(),
                ktype=KLType.K_DAY,
                autype=_futu_adjust(adjust),
                page_req_key=page_req_key,
            )
            if ret != RET_OK:
                raise RuntimeError(f"Futu OpenD 返回错误: {data}")
            frames.append(data)
            if not page_req_key:
                break
    finally:
        quote_ctx.close()

    raw = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if raw.empty:
        raise RuntimeError(f"Futu OpenD returned no data for {code}.")

    raw = raw.rename(columns={"time_key": "date"})
    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _normalize_ohlcv(raw)


def _load_auto_daily(market: Market, symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
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


def load_daily_bars(
    market: Market,
    symbol: str,
    start: date,
    end: date,
    adjust: str = "qfq",
    data_source: DataSource = DataSource.AUTO,
    futu_host: str = "127.0.0.1",
    futu_port: int = 11111,
) -> pd.DataFrame:
    if data_source == DataSource.FUTU:
        return _load_futu_daily(
            market=market,
            symbol=symbol,
            start=start,
            end=end,
            adjust=adjust,
            host=futu_host,
            port=futu_port,
        )
    return _load_auto_daily(market=market, symbol=symbol, start=start, end=end, adjust=adjust)
