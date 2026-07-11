from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class BacktestStats:
    start: str
    end: str
    total_return: float
    benchmark_return: float
    annualized_return: float
    max_drawdown: float
    sharpe: float
    trade_count: int
    win_rate: float
    final_equity: float

    def to_dict(self) -> dict[str, float | int | str]:
        return asdict(self)


def format_pct(value: float) -> str:
    return f"{value * 100:.2f}%"


def format_money(value: float) -> str:
    return f"{value:,.2f}"


def max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    drawdown = (equity / peak.replace(0, np.nan) - 1).replace([np.inf, -np.inf], np.nan).dropna()
    if drawdown.empty:
        return 0.0
    return float(drawdown.min())


def annualized_return(equity: pd.Series) -> float:
    if len(equity) < 2:
        return 0.0
    if equity.iloc[0] <= 0:
        return 0.0
    total_return = equity.iloc[-1] / equity.iloc[0] - 1
    if total_return <= -1:
        return -1.0
    years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1 / 365.25)
    return float((1 + total_return) ** (1 / years) - 1)


def sharpe_ratio(equity: pd.Series) -> float:
    returns = equity.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
    if len(returns) < 2 or returns.std() == 0:
        return 0.0
    return float(np.sqrt(252) * returns.mean() / returns.std())
