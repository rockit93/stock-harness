from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd

from .data import DataSource, Market, _a_share_yahoo_ticker, _futu_code, _hk_ticker, normalize_symbol


@dataclass
class FundamentalSnapshot:
    revenue: float | None = None
    net_income: float | None = None
    roe: float | None = None
    operating_cash_flow: float | None = None
    pe: float | None = None
    debt_ratio: float | None = None
    dividend_yield: float | None = None
    currency: str = ""
    period: str = ""
    source: str = "unknown"


def _ticker_symbol(market: Market, symbol: str) -> str:
    if market == Market.A_SHARE:
        return _a_share_yahoo_ticker(symbol)
    if market == Market.HK:
        return _hk_ticker(symbol)
    return normalize_symbol(Market.US, symbol)


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _ratio(value: Any) -> float | None:
    number = _finite(value)
    if number is None:
        return None
    return number / 100 if abs(number) > 1 else number


def _safe_call(default: Any, callback: Callable[[], Any]) -> Any:
    try:
        return callback()
    except Exception:
        return default


def _first_value(frame: pd.DataFrame, names: tuple[str, ...]) -> float | None:
    if frame is None or frame.empty:
        return None
    index_map = {str(index).strip().lower(): index for index in frame.index}
    for name in names:
        row_key = index_map.get(name.lower())
        if row_key is None:
            continue
        series = frame.loc[row_key].dropna()
        if not series.empty:
            return _finite(series.iloc[0])
    return None


def _latest_period(*frames: pd.DataFrame) -> str:
    for frame in frames:
        if frame is None or frame.empty:
            continue
        first_column = frame.columns[0]
        if hasattr(first_column, "date"):
            return first_column.date().isoformat()
        return str(first_column)
    return ""


def _format_money(value: float | None, currency: str) -> str:
    if value is None:
        return "-"
    abs_value = abs(value)
    prefix = f"{currency} " if currency else ""
    if abs_value >= 1_000_000_000_000:
        return f"{prefix}{value / 1_000_000_000_000:.2f}万亿"
    if abs_value >= 100_000_000:
        return f"{prefix}{value / 100_000_000:.2f}亿"
    if abs_value >= 10_000:
        return f"{prefix}{value / 10_000:.2f}万"
    return f"{prefix}{value:.2f}"


def _format_percent(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value * 100:.2f}%"


def _format_multiple(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.2f}x"


def _metric(key: str, label: str, value: float | None, display: str) -> dict[str, Any]:
    return {"key": key, "label": label, "value": value, "display": display}


def _classify(snapshot: FundamentalSnapshot) -> dict[str, Any]:
    reasons: list[str] = []
    risk_flags = 0

    if snapshot.net_income is not None and snapshot.net_income <= 0:
        risk_flags += 2
        reasons.append("净利润为负")
    if snapshot.operating_cash_flow is not None and snapshot.operating_cash_flow <= 0:
        risk_flags += 1
        reasons.append("经营现金流偏弱")
    if snapshot.debt_ratio is not None and snapshot.debt_ratio >= 0.7:
        risk_flags += 1
        reasons.append("负债率较高")
    if snapshot.roe is not None and snapshot.roe < 0.08:
        reasons.append("ROE 不够理想")

    pe = snapshot.pe
    if risk_flags >= 2:
        category = "危险公司"
        tone = "danger"
    elif pe is not None and 0 < pe <= 12 and (risk_flags or (snapshot.roe is not None and snapshot.roe < 0.1)):
        category = "便宜但有坑的公司"
        tone = "warning"
        reasons.append("估值低但质量信号不足")
    elif pe is not None and pe >= 40:
        category = "贵公司"
        tone = "expensive"
        reasons.append("PE 明显偏高")
    elif (
        snapshot.net_income is not None
        and snapshot.net_income > 0
        and snapshot.operating_cash_flow is not None
        and snapshot.operating_cash_flow > 0
        and snapshot.roe is not None
        and snapshot.roe >= 0.15
        and (snapshot.debt_ratio is None or snapshot.debt_ratio < 0.65)
    ):
        category = "好公司"
        tone = "good"
        reasons.append("盈利、ROE 和现金流表现较稳")
    else:
        category = "贵公司" if pe is not None and pe >= 30 else "便宜但有坑的公司"
        tone = "neutral"
        reasons.append("需要结合行业和近年趋势继续确认")

    available = sum(
        value is not None
        for value in (
            snapshot.revenue,
            snapshot.net_income,
            snapshot.roe,
            snapshot.operating_cash_flow,
            snapshot.pe,
            snapshot.debt_ratio,
            snapshot.dividend_yield,
        )
    )
    if available < 3:
        return {
            "category": "数据不足",
            "tone": "neutral",
            "confidence": "低",
            "summary": "基本面数据不足，暂时不做强判断。",
            "reasons": ["营收、利润、现金流或估值数据缺失较多"],
        }

    confidence = "高" if available >= 6 else "中"
    return {
        "category": category,
        "tone": tone,
        "confidence": confidence,
        "summary": "；".join(reasons[:2]) if reasons else "基本面信号较均衡",
        "reasons": reasons[:4],
    }


def _item_by_property(report: dict[str, Any], property_key: Any, aliases: tuple[str, ...] = ()) -> float | None:
    try:
        property_id = int(property_key)
    except (TypeError, ValueError):
        property_id = None

    alias_set = {alias.lower() for alias in aliases}
    for item in report.get("item_list", []):
        field_id = item.get("field_id")
        display_name = str(item.get("display_name", "")).strip().lower()
        if property_id is not None and field_id == property_id:
            return _finite(item.get("data"))
        if display_name and any(alias in display_name for alias in alias_set):
            return _finite(item.get("data"))
    return None


def _item_by_ids(report: dict[str, Any] | None, field_ids: tuple[int, ...]) -> float | None:
    if not report:
        return None
    for item in report.get("item_list", []):
        if item.get("field_id") in field_ids:
            value = _finite(item.get("data"))
            if value is not None:
                return value
    return None


def _report_value(reports: dict[int, dict[str, Any]], statement_type: int, property_key: Any, aliases: tuple[str, ...] = ()) -> float | None:
    report = reports.get(statement_type)
    if not report:
        return None
    return _item_by_property(report, property_key, aliases)


def _first_snapshot_value(frame: pd.DataFrame, names: tuple[str, ...]) -> float | None:
    if frame is None or frame.empty:
        return None
    row = frame.iloc[0]
    lower_columns = {str(column).lower(): column for column in frame.columns}
    for name in names:
        column = lower_columns.get(name.lower())
        if column is not None:
            return _finite(row.get(column))
    return None


def _load_futu_snapshot(market: Market, symbol: str, host: str, port: int) -> FundamentalSnapshot:
    from futu import FinancialProperty, OpenQuoteContext, RET_OK

    code = _futu_code(market, symbol)
    quote_ctx = OpenQuoteContext(host=host, port=port)
    reports: dict[int, dict[str, Any]] = {}
    snapshot_frame = pd.DataFrame()

    try:
        for statement_type in (1, 2, 3, 4):
            ret, payload = quote_ctx.get_financials_statements(code, statement_type=statement_type, financial_type=10, num=1)
            if ret != RET_OK:
                raise RuntimeError(f"Futu OpenD 财务接口返回错误: {payload}")
            report_list = payload.get("report_list", [])
            if report_list:
                reports[statement_type] = report_list[0]

        ret, payload = quote_ctx.get_market_snapshot([code])
        if ret == RET_OK:
            snapshot_frame = payload
    finally:
        quote_ctx.close()

    key_report = reports.get(4, {})
    period = str(key_report.get("date_time_str") or key_report.get("period_text") or "")
    currency = str(key_report.get("currency_code") or key_report.get("currency_info") or "")

    income_report = reports.get(1)
    balance_report = reports.get(2)
    cashflow_report = reports.get(3)

    revenue = _item_by_ids(income_report, (8001, 8002)) or _report_value(reports, 1, FinancialProperty.REVENUE, ("revenue", "营收", "营业收入"))
    net_income = _item_by_ids(income_report, (8037, 8043, 8046)) or _report_value(reports, 1, FinancialProperty.NET_PROFIT, ("net profit", "净利润"))
    operating_cash_flow = _item_by_ids(cashflow_report, (8015, 8016)) or _report_value(
        reports,
        3,
        FinancialProperty.OPERATING_CASH_FLOW_TTM,
        ("operating cash flow", "经营现金流", "经营活动现金流"),
    )
    roe = _ratio(_report_value(reports, 4, FinancialProperty.ROE, ("roe", "净资产收益率")))
    total_assets = _item_by_ids(balance_report, (8001,))
    total_liabilities = _item_by_ids(balance_report, (8048,))
    debt_ratio = total_liabilities / total_assets if total_assets and total_liabilities is not None else None
    if debt_ratio is None:
        debt_ratio = _ratio(_report_value(reports, 4, FinancialProperty.DEBT_TO_ASSETS, ("debt to assets", "资产负债率", "负债率")))
    dividend_yield = _ratio(
        _report_value(reports, 4, FinancialProperty.DIVIDENDS_TTM_RATIO, ("dividend", "股息率"))
        or _report_value(reports, 4, FinancialProperty.DIVIDENDS_LFY_RATIO, ("dividend", "股息率"))
    )
    pe = _first_snapshot_value(snapshot_frame, ("pe_ratio", "pe_ttm", "static_pe", "pe", "trailing_pe", "forward_pe"))

    return FundamentalSnapshot(
        revenue=revenue,
        net_income=net_income,
        roe=roe,
        operating_cash_flow=operating_cash_flow,
        pe=pe,
        debt_ratio=debt_ratio,
        dividend_yield=dividend_yield,
        currency=currency,
        period=period,
        source="futu",
    )


def _load_yfinance_snapshot(market: Market, symbol: str) -> FundamentalSnapshot:
    import yfinance as yf

    ticker = yf.Ticker(_ticker_symbol(market, symbol))
    info = _safe_call({}, ticker.get_info) or {}
    financials = _safe_call(pd.DataFrame(), lambda: ticker.financials)
    cashflow = _safe_call(pd.DataFrame(), lambda: ticker.cashflow)
    balance_sheet = _safe_call(pd.DataFrame(), lambda: ticker.balance_sheet)

    revenue = _first_value(financials, ("Total Revenue", "Operating Revenue"))
    net_income = _first_value(financials, ("Net Income", "Net Income Common Stockholders"))
    operating_cash_flow = _first_value(cashflow, ("Operating Cash Flow", "Total Cash From Operating Activities"))
    total_assets = _first_value(balance_sheet, ("Total Assets",))
    total_debt = _first_value(balance_sheet, ("Total Debt", "Long Term Debt And Capital Lease Obligation"))
    equity = _first_value(balance_sheet, ("Stockholders Equity", "Total Equity Gross Minority Interest"))

    roe = _ratio(info.get("returnOnEquity"))
    if roe is None and net_income is not None and equity:
        roe = net_income / equity

    debt_ratio = total_debt / total_assets if total_debt is not None and total_assets else None

    return FundamentalSnapshot(
        revenue=revenue,
        net_income=net_income,
        roe=roe,
        operating_cash_flow=operating_cash_flow,
        pe=_finite(info.get("trailingPE") or info.get("forwardPE")),
        debt_ratio=debt_ratio,
        dividend_yield=_ratio(info.get("dividendYield")),
        currency=str(info.get("financialCurrency") or info.get("currency") or ""),
        period=_latest_period(financials, cashflow, balance_sheet),
        source="yfinance",
    )


def _payload(market: Market, symbol: str, snapshot: FundamentalSnapshot, warning: str | None = None) -> dict[str, Any]:
    return {
        "market": market.value,
        "symbol": normalize_symbol(market, symbol),
        "ticker": _futu_code(market, symbol) if snapshot.source == "futu" else _ticker_symbol(market, symbol),
        "period": snapshot.period,
        "source": snapshot.source,
        "metrics": [
            _metric("revenue", "营收", snapshot.revenue, _format_money(snapshot.revenue, snapshot.currency)),
            _metric("net_income", "净利润", snapshot.net_income, _format_money(snapshot.net_income, snapshot.currency)),
            _metric("roe", "ROE", snapshot.roe, _format_percent(snapshot.roe)),
            _metric("operating_cash_flow", "经营现金流", snapshot.operating_cash_flow, _format_money(snapshot.operating_cash_flow, snapshot.currency)),
            _metric("pe", "PE", snapshot.pe, _format_multiple(snapshot.pe)),
            _metric("debt_ratio", "负债率", snapshot.debt_ratio, _format_percent(snapshot.debt_ratio)),
            _metric("dividend_yield", "股息率", snapshot.dividend_yield, _format_percent(snapshot.dividend_yield)),
        ],
        "ai_judgement": _classify(snapshot),
        "note": "AI 判断为规则评分结果，仅用于初筛，不构成投资建议。",
        **({"warning": warning} if warning else {}),
    }


def load_fundamentals(
    market: Market,
    symbol: str,
    data_source: DataSource = DataSource.AUTO,
    futu_host: str = "127.0.0.1",
    futu_port: int = 11111,
) -> dict[str, Any]:
    if data_source == DataSource.FUTU:
        return _payload(market, symbol, _load_futu_snapshot(market, symbol, futu_host, futu_port))

    try:
        snapshot = _load_futu_snapshot(market, symbol, futu_host, futu_port)
        return _payload(market, symbol, snapshot)
    except Exception as exc:
        snapshot = _load_yfinance_snapshot(market, symbol)
        return _payload(market, symbol, snapshot, warning=f"Futu OpenD 不可用，已降级到 yfinance: {exc}")
