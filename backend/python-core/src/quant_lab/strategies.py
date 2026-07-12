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
    english_label: str
    description: str
    rule_summary: str
    strategy_cls: type[bt.Strategy]
    default_params: dict[str, Any]


STRATEGIES: dict[str, StrategySpec] = {
    "ma_cross": StrategySpec(
        key="ma_cross",
        label="双均线交叉策略",
        english_label="Moving Average Cross",
        description="使用短期与长期简单移动平均线判断趋势变化。短期均线向上突破长期均线时认为上涨趋势形成并买入；短期均线向下跌破长期均线时认为趋势转弱并平仓。适合趋势较明显的行情，震荡市场中可能频繁产生无效信号。",
        rule_summary="10 日均线上穿 30 日均线买入；10 日均线下穿 30 日均线平仓。",
        strategy_cls=MovingAverageCross,
        default_params={"fast": 10, "slow": 30},
    ),
    "rsi_mean_reversion": StrategySpec(
        key="rsi_mean_reversion",
        label="RSI 均值回归策略",
        english_label="RSI Mean Reversion",
        description="利用相对强弱指标 RSI 判断短期超卖和反弹。RSI 低于下限时认为价格可能过度下跌并买入；RSI 回升到上限以上时平仓。适合区间震荡、具有均值回归特征的股票，单边下跌时应结合止损控制风险。",
        rule_summary="14 周期 RSI 低于 30 买入；RSI 高于 60 平仓。",
        strategy_cls=RsiMeanReversion,
        default_params={"period": 14, "lower": 30, "upper": 60},
    ),
}
