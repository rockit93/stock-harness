from __future__ import annotations

from collections import OrderedDict
from datetime import date, timedelta
from enum import Enum
from threading import Lock, RLock
from time import monotonic

import pandas as pd


class Market(str, Enum):
    A_SHARE = "A Share"
    HK = "Hong Kong"
    US = "US"


class DataSource(str, Enum):
    AUTO = "auto"
    FUTU = "futu"


class BarInterval(str, Enum):
    MIN_1 = "1m"
    MIN_15 = "15m"
    MIN_30 = "30m"
    HOUR_1 = "1h"
    HOUR_4 = "4h"
    DAY = "1d"


_BAR_CACHE_MAX_ENTRIES = 256
_BAR_CACHE_TTL_SECONDS = {
    BarInterval.MIN_1: 30,
    BarInterval.MIN_15: 60,
    BarInterval.MIN_30: 120,
    BarInterval.HOUR_1: 180,
    BarInterval.HOUR_4: 300,
    BarInterval.DAY: 900,
}
_bar_cache: OrderedDict[tuple, tuple[float, pd.DataFrame]] = OrderedDict()
_bar_cache_locks: dict[tuple, Lock] = {}
_bar_cache_guard = RLock()


def _bar_cache_key(
    market: Market,
    symbol: str,
    start: date,
    end: date,
    adjust: str,
    data_source: DataSource,
    futu_host: str,
    futu_port: int,
    interval: BarInterval,
) -> tuple:
    return (
        market.value,
        normalize_symbol(market, symbol),
        start.isoformat(),
        end.isoformat(),
        adjust,
        data_source.value,
        futu_host.strip().lower() if data_source == DataSource.FUTU else "",
        futu_port if data_source == DataSource.FUTU else 0,
        interval.value,
    )


def _get_cached_bars(key: tuple) -> pd.DataFrame | None:
    now = monotonic()
    with _bar_cache_guard:
        cached = _bar_cache.get(key)
        if cached is None:
            return None
        expires_at, frame = cached
        if expires_at <= now:
            del _bar_cache[key]
            return None
        _bar_cache.move_to_end(key)
        return frame.copy()


def _put_cached_bars(key: tuple, frame: pd.DataFrame, interval: BarInterval) -> None:
    expires_at = monotonic() + _BAR_CACHE_TTL_SECONDS[interval]
    with _bar_cache_guard:
        _bar_cache[key] = (expires_at, frame.copy())
        _bar_cache.move_to_end(key)
        while len(_bar_cache) > _BAR_CACHE_MAX_ENTRIES:
            _bar_cache.popitem(last=False)


def _cache_lock(key: tuple) -> Lock:
    with _bar_cache_guard:
        lock = _bar_cache_locks.get(key)
        if lock is None:
            lock = Lock()
            _bar_cache_locks[key] = lock
        return lock


def _normalize_ohlcv(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    column_aliases = {
        "日期": "date",
        "开盘": "open",
        "最高": "high",
        "最低": "low",
        "收盘": "close",
        "成交量": "volume",
        "成交额": "amount",
    }
    frame = frame.rename(columns={column: column_aliases.get(str(column).strip(), column) for column in frame.columns})
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
        symbol=normalize_symbol(Market.A_SHARE, symbol),
        period="daily",
        start_date=start.strftime("%Y%m%d"),
        end_date=end.strftime("%Y%m%d"),
        adjust=adjust,
    )
    if raw.empty:
        raise RuntimeError("AkShare returned no A-share data.")

    raw["date"] = pd.to_datetime(raw["日期"])
    raw = raw.set_index("date")
    return _normalize_ohlcv(raw)


def _load_ak_hk_daily(symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
    import akshare as ak

    raw = ak.stock_hk_daily(symbol=normalize_symbol(Market.HK, symbol), adjust=adjust)
    if raw.empty:
        raise RuntimeError(f"AkShare returned no Hong Kong data for {symbol}.")

    raw["date"] = pd.to_datetime(raw["date"])
    raw = raw.set_index("date")
    return _filter_dates(_normalize_ohlcv(raw), start, end)


def _load_ak_us_daily(symbol: str, start: date, end: date, adjust: str) -> pd.DataFrame:
    import akshare as ak

    raw = ak.stock_us_daily(symbol=normalize_symbol(Market.US, symbol), adjust=adjust)
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
        end=(end + timedelta(days=1)).isoformat(),
        auto_adjust=False,
        progress=False,
        group_by="column",
    )
    if raw.empty:
        raise RuntimeError(f"Yahoo Finance returned no data for {ticker}.")

    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)
    return _normalize_ohlcv(raw)


def normalize_symbol(market: Market, symbol: str) -> str:
    clean = symbol.upper().strip()
    if market == Market.A_SHARE:
        return clean.replace("SH.", "").replace("SZ.", "")
    if market == Market.HK:
        return clean.replace("HK.", "").replace(".HK", "").zfill(5)
    if market == Market.US:
        return clean.replace("US.", "").replace(".US", "")
    return clean


def _hk_ticker(symbol: str) -> str:
    return f"{normalize_symbol(Market.HK, symbol).zfill(4)}.HK"


def _a_share_yahoo_ticker(symbol: str) -> str:
    clean = normalize_symbol(Market.A_SHARE, symbol)
    if clean.startswith(("5", "6", "9")):
        return f"{clean}.SS"
    return f"{clean}.SZ"


def _a_share_futu_code(symbol: str) -> str:
    clean = normalize_symbol(Market.A_SHARE, symbol)
    if clean.startswith(("5", "6", "9")):
        return f"SH.{clean}"
    return f"SZ.{clean}"


def _futu_code(market: Market, symbol: str) -> str:
    clean = symbol.upper().strip()
    if market == Market.A_SHARE:
        return _a_share_futu_code(clean)
    if market == Market.HK:
        return f"HK.{normalize_symbol(Market.HK, clean)}"
    if market == Market.US:
        return f"US.{normalize_symbol(Market.US, clean)}"
    raise ValueError(f"Unsupported market for Futu: {market}")


def _futu_adjust(adjust: str):
    from futu import AuType

    if adjust == "qfq":
        return AuType.QFQ
    if adjust == "hfq":
        return AuType.HFQ
    return AuType.NONE


def _load_futu_bars(
    market: Market,
    symbol: str,
    start: date,
    end: date,
    adjust: str,
    host: str,
    port: int,
    interval: BarInterval,
) -> pd.DataFrame:
    try:
        from futu import KLType, OpenQuoteContext, RET_OK
    except ImportError as exc:
        raise RuntimeError("未安装 futu-api。请运行 pip install futu-api 后重试。") from exc

    ktype = {
        BarInterval.MIN_1: KLType.K_1M,
        BarInterval.MIN_15: KLType.K_15M,
        BarInterval.MIN_30: KLType.K_30M,
        BarInterval.HOUR_1: KLType.K_60M,
        BarInterval.HOUR_4: KLType.K_240M,
        BarInterval.DAY: KLType.K_DAY,
    }[interval]
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
                ktype=ktype,
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
    errors = []
    if market == Market.A_SHARE:
        for loader in (
            lambda: _load_a_share(symbol=symbol, start=start, end=end, adjust=adjust),
            lambda: _load_yfinance(_a_share_yahoo_ticker(symbol), start=start, end=end),
        ):
            try:
                return loader()
            except Exception as exc:
                errors.append(str(exc))
    elif market == Market.HK:
        for loader in (
            lambda: _load_ak_hk_daily(symbol, start=start, end=end, adjust=adjust),
            lambda: _load_yfinance(_hk_ticker(symbol), start=start, end=end),
        ):
            try:
                return loader()
            except Exception as exc:
                errors.append(str(exc))
    elif market == Market.US:
        for loader in (
            lambda: _load_ak_us_daily(symbol, start=start, end=end, adjust=adjust),
            lambda: _load_yfinance(normalize_symbol(Market.US, symbol), start=start, end=end),
        ):
            try:
                return loader()
            except Exception as exc:
                errors.append(str(exc))
    else:
        raise ValueError(f"Unsupported market: {market}")

    raise RuntimeError(
        "当前行情数据源连接失败。可以检查本机代理/网络，或启动 Futu OpenD 后把数据源切到 Futu。"
        f" 原始错误: {' | '.join(errors[-2:])}"
    )


def load_daily_bars(
    market: Market,
    symbol: str,
    start: date,
    end: date,
    adjust: str = "qfq",
    data_source: DataSource = DataSource.AUTO,
    futu_host: str = "127.0.0.1",
    futu_port: int = 11111,
    interval: BarInterval = BarInterval.DAY,
) -> pd.DataFrame:
    key = _bar_cache_key(
        market, symbol, start, end, adjust, data_source, futu_host, futu_port, interval
    )
    cached = _get_cached_bars(key)
    if cached is not None:
        return cached

    # Only one worker fetches a given request while concurrent callers wait and
    # reuse its result. This prevents a dashboard refresh from creating bursts.
    with _cache_lock(key):
        cached = _get_cached_bars(key)
        if cached is not None:
            return cached

        if data_source == DataSource.FUTU:
            frame = _load_futu_bars(
                market=market,
                symbol=symbol,
                start=start,
                end=end,
                adjust=adjust,
                host=futu_host,
                port=futu_port,
                interval=interval,
            )
        else:
            if interval != BarInterval.DAY:
                raise RuntimeError("分钟线和小时线需要将数据源切换为 Futu OpenD。")
            frame = _load_auto_daily(market=market, symbol=symbol, start=start, end=end, adjust=adjust)

        _put_cached_bars(key, frame, interval)
        return frame.copy()


def _market_from_futu_code(code: str) -> Market | None:
    upper = code.upper()
    if upper.startswith(("SH.", "SZ.")):
        return Market.A_SHARE
    if upper.startswith("HK."):
        return Market.HK
    if upper.startswith("US."):
        return Market.US
    return None


def _record(market: Market, symbol: str, name: str, source: str, raw_code: str | None = None) -> dict[str, str]:
    return {
        "market": market.value,
        "symbol": normalize_symbol(market, symbol),
        "name": name,
        "source": source,
        "raw_code": raw_code or symbol,
    }


POPULAR_SYMBOLS: dict[tuple[Market, str], str] = {
    (Market.A_SHARE, "600519"): "贵州茅台",
    (Market.A_SHARE, "000001"): "平安银行",
    (Market.A_SHARE, "601318"): "中国平安",
    (Market.A_SHARE, "600036"): "招商银行",
    (Market.A_SHARE, "300750"): "宁德时代",
    (Market.HK, "00700"): "腾讯控股",
    (Market.HK, "09988"): "阿里巴巴-W",
    (Market.HK, "03690"): "美团-W",
    (Market.US, "AAPL"): "Apple",
    (Market.US, "TSLA"): "Tesla",
    (Market.US, "NVDA"): "NVIDIA",
    (Market.US, "MSFT"): "Microsoft",
}


def _lookup_popular(market: Market, keyword: str, limit: int) -> list[dict[str, str]]:
    text = keyword.strip().upper()
    matches = []
    for (item_market, symbol), name in POPULAR_SYMBOLS.items():
        if item_market != market:
            continue
        if text in symbol.upper() or keyword.strip().lower() in name.lower():
            matches.append(_record(item_market, symbol, name, "builtin"))
    return matches[:limit]


def _lookup_futu(keyword: str, host: str, port: int, limit: int) -> list[dict[str, str]]:
    try:
        from futu import OpenQuoteContext, RET_OK
    except ImportError:
        return []

    quote_ctx = OpenQuoteContext(host=host, port=port)
    try:
        ret, data = quote_ctx.get_search_quote(keyword, max_count=limit)
        if ret != RET_OK or data.empty:
            return []
        records = []
        for _, row in data.iterrows():
            code = str(row.get("code", "")).strip()
            market = _market_from_futu_code(code)
            name = str(row.get("name", "")).strip()
            if market and code and name:
                records.append(_record(market, code, name, "futu", code))
        return records[:limit]
    except Exception:
        return []
    finally:
        quote_ctx.close()


def test_futu_connection(host: str = "127.0.0.1", port: int = 11111) -> dict[str, str]:
    try:
        from futu import OpenQuoteContext, RET_OK
    except ImportError as exc:
        raise RuntimeError("未安装 futu-api。请运行 pip install futu-api 后重试。") from exc

    quote_ctx = OpenQuoteContext(host=host, port=port)
    try:
        ret, data = quote_ctx.get_global_state()
        if ret != RET_OK:
            raise RuntimeError(f"Futu OpenD 返回错误: {data}")
        return {"status": "ok", "host": host, "port": str(port)}
    finally:
        quote_ctx.close()


def _lookup_akshare(market: Market, keyword: str, limit: int) -> list[dict[str, str]]:
    try:
        import akshare as ak
    except ImportError:
        return []

    text = keyword.strip().upper()
    try:
        if market == Market.A_SHARE:
            frame = ak.stock_info_a_code_name()
            code_column = "code"
            name_column = "name"
        elif market == Market.HK:
            frame = ak.stock_hk_spot_em()
            code_column = "代码"
            name_column = "名称"
        elif market == Market.US:
            frame = ak.stock_us_spot_em()
            code_column = "代码"
            name_column = "名称"
        else:
            return []
    except Exception:
        return []

    if frame.empty:
        return []

    records = []
    for _, row in frame.iterrows():
        symbol = str(row.get(code_column, "")).strip().upper()
        name = str(row.get(name_column, "")).strip()
        if not symbol or not name:
            continue
        if text in symbol.upper() or keyword.strip().lower() in name.lower():
            records.append(_record(market, symbol, name, "akshare"))
        if len(records) >= limit:
            break
    return records


def lookup_symbols(
    market: Market,
    keyword: str,
    limit: int = 8,
    data_source: DataSource = DataSource.AUTO,
    futu_host: str = "127.0.0.1",
    futu_port: int = 11111,
) -> list[dict[str, str]]:
    clean = keyword.strip()
    if not clean:
        return []

    records: list[dict[str, str]] = []
    if data_source == DataSource.FUTU:
        records.extend(_lookup_futu(clean, futu_host, futu_port, limit))
    else:
        records.extend(_lookup_popular(market, clean, limit))
        if len(records) < limit:
            records.extend(_lookup_akshare(market, clean, limit - len(records)))
        if len(records) < limit:
            records.extend(_lookup_futu(clean, futu_host, futu_port, limit - len(records)))

    deduped = []
    seen = set()
    for record in records:
        key = (record["market"], record["symbol"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped[:limit]
