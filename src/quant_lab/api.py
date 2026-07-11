from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .data import DataSource, Market, load_daily_bars, lookup_symbols, test_futu_connection
from .engine import run_backtest
from .strategies import STRATEGIES


app = FastAPI(title="stock-harness Python Core", version="0.1.0")


class BarsRequest(BaseModel):
    market: Market = Market.A_SHARE
    symbol: str = "600519"
    start: date
    end: date
    adjust: str = "qfq"
    data_source: DataSource = DataSource.AUTO
    futu_host: str = "127.0.0.1"
    futu_port: int = 11111


class SymbolLookupRequest(BaseModel):
    market: Market = Market.A_SHARE
    keyword: str = ""
    limit: int = 8
    data_source: DataSource = DataSource.AUTO
    futu_host: str = "127.0.0.1"
    futu_port: int = 11111


class FutuConnectionRequest(BaseModel):
    futu_host: str = "127.0.0.1"
    futu_port: int = 11111


class BacktestRequest(BarsRequest):
    strategy: str = "ma_cross"
    strategy_params: dict[str, Any] = Field(default_factory=dict)
    cash: float = 100000.0
    commission_bps: float = 3.0


def _series_payload(series, limit: int = 500) -> list[dict[str, Any]]:
    tail = series.tail(limit)
    return [{"date": idx.date().isoformat(), "value": float(value)} for idx, value in tail.items()]


def _frame_payload(frame, limit: int = 500) -> list[dict[str, Any]]:
    output = frame.tail(limit).reset_index()
    first_column = output.columns[0]
    output[first_column] = output[first_column].dt.date.astype(str)
    return output.to_dict(orient="records")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "python-core"}


@app.get("/strategies")
def strategies() -> list[dict[str, Any]]:
    return [
        {
            "key": key,
            "label": spec.label,
            "default_params": spec.default_params,
        }
        for key, spec in STRATEGIES.items()
    ]


@app.post("/bars")
def bars(request: BarsRequest) -> dict[str, Any]:
    if request.start >= request.end:
        raise HTTPException(status_code=400, detail="start must be earlier than end")

    try:
        frame = load_daily_bars(
            market=request.market,
            symbol=request.symbol,
            start=request.start,
            end=request.end,
            adjust="" if request.adjust == "none" else request.adjust,
            data_source=request.data_source,
            futu_host=request.futu_host,
            futu_port=request.futu_port,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"bars": _frame_payload(frame)}


@app.post("/symbols/lookup")
def symbols_lookup(request: SymbolLookupRequest) -> dict[str, Any]:
    limit = max(1, min(request.limit, 20))
    try:
        symbols = lookup_symbols(
            market=request.market,
            keyword=request.keyword,
            limit=limit,
            data_source=request.data_source,
            futu_host=request.futu_host,
            futu_port=request.futu_port,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"symbols": symbols}


@app.post("/futu/test-connection")
def futu_test_connection(request: FutuConnectionRequest) -> dict[str, Any]:
    try:
        return test_futu_connection(host=request.futu_host, port=request.futu_port)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/backtest")
def backtest(request: BacktestRequest) -> dict[str, Any]:
    if request.start >= request.end:
        raise HTTPException(status_code=400, detail="start must be earlier than end")

    spec = STRATEGIES.get(request.strategy)
    if not spec:
        raise HTTPException(status_code=400, detail=f"unknown strategy: {request.strategy}")

    params = dict(spec.default_params)
    params.update(request.strategy_params)

    try:
        frame = load_daily_bars(
            market=request.market,
            symbol=request.symbol,
            start=request.start,
            end=request.end,
            adjust="" if request.adjust == "none" else request.adjust,
            data_source=request.data_source,
            futu_host=request.futu_host,
            futu_port=request.futu_port,
        )
        result = run_backtest(
            bars=frame,
            strategy_spec=spec,
            strategy_params=params,
            cash=request.cash,
            commission=request.commission_bps / 10000,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "stats": result.stats.to_dict(),
        "equity": _series_payload(result.equity),
        "benchmark_equity": _series_payload(result.benchmark_equity),
        "drawdown": _series_payload(result.drawdown),
        "bars": _frame_payload(frame),
        "trades": result.trades.to_dict(orient="records"),
    }
