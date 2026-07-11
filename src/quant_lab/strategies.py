from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import backtrader as bt


class MovingAverageCross(bt.Strategy):
    params = dict(fast=10, slow=30)

    def __init__(self):
        fast_ma = bt.ind.SMA(self.data.close, period=self.p.fast)
        slow_ma = bt.ind.SMA(self.data.close, period=self.p.slow)
        self.cross = bt.ind.CrossOver(fast_ma, slow_ma)

    def next(self):
        if not self.position and self.cross > 0:
            self.buy()
        elif self.position and self.cross < 0:
            self.close()


class RsiMeanReversion(bt.Strategy):
    params = dict(period=14, lower=30, upper=60)

    def __init__(self):
        self.rsi = bt.ind.RSI(self.data.close, period=self.p.period)

    def next(self):
        if not self.position and self.rsi < self.p.lower:
            self.buy()
        elif self.position and self.rsi > self.p.upper:
            self.close()


@dataclass(frozen=True)
class StrategySpec:
    key: str
    label: str
    strategy_cls: type[bt.Strategy]
    default_params: dict[str, Any]


STRATEGIES: dict[str, StrategySpec] = {
    "ma_cross": StrategySpec(
        key="ma_cross",
        label="Moving Average Cross",
        strategy_cls=MovingAverageCross,
        default_params={"fast": 10, "slow": 30},
    ),
    "rsi_mean_reversion": StrategySpec(
        key="rsi_mean_reversion",
        label="RSI Mean Reversion",
        strategy_cls=RsiMeanReversion,
        default_params={"period": 14, "lower": 30, "upper": 60},
    ),
}
