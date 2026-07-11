from __future__ import annotations

from typing import Any

import backtrader as bt


SUPPORTED_INDICATORS = {"sma", "ema", "rsi"}
SUPPORTED_OPERATORS = {">", ">=", "<", "<=", "==", "!=", "crosses_above", "crosses_below"}


def validate_strategy_definition(definition: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(definition, dict):
        raise ValueError("strategy_definition must be an object")
    indicators = definition.get("indicators")
    if not isinstance(indicators, dict) or not indicators:
        raise ValueError("strategy_definition.indicators must be a non-empty object")
    if len(indicators) > 20:
        raise ValueError("a strategy can define at most 20 indicators")
    for name, spec in indicators.items():
        if not isinstance(name, str) or not name.isidentifier():
            raise ValueError(f"invalid indicator name: {name}")
        if not isinstance(spec, dict) or spec.get("type") not in SUPPORTED_INDICATORS:
            raise ValueError(f"unsupported indicator type for {name}")
        period = spec.get("period")
        if not isinstance(period, int) or period < 2 or period > 500:
            raise ValueError(f"indicator {name} period must be an integer between 2 and 500")
    for side in ("entry", "exit"):
        group = definition.get(side)
        if not isinstance(group, dict) or not any(key in group for key in ("all", "any")):
            raise ValueError(f"strategy_definition.{side} must contain all or any")
        for mode in ("all", "any"):
            conditions = group.get(mode, [])
            if not isinstance(conditions, list):
                raise ValueError(f"{side}.{mode} must be an array")
            for condition in conditions:
                _validate_condition(condition, indicators)
    risk = definition.get("risk", {})
    if not isinstance(risk, dict):
        raise ValueError("strategy_definition.risk must be an object")
    for key in ("stop_loss_pct", "take_profit_pct"):
        if key in risk and (not isinstance(risk[key], (int, float)) or not 0 < float(risk[key]) < 1):
            raise ValueError(f"risk.{key} must be greater than 0 and less than 1")
    return definition


def _validate_condition(condition: Any, indicators: dict[str, Any]) -> None:
    if not isinstance(condition, dict):
        raise ValueError("each condition must be an object")
    if condition.get("op") not in SUPPORTED_OPERATORS:
        raise ValueError(f"unsupported condition operator: {condition.get('op')}")
    for side in ("left", "right"):
        operand = condition.get(side)
        if isinstance(operand, (int, float)):
            continue
        if operand == "close" or operand in indicators:
            continue
        raise ValueError(f"unknown condition operand: {operand}")


class JsonRuleStrategy(bt.Strategy):
    params = dict(definition=None)

    def __init__(self):
        self.definition = validate_strategy_definition(self.p.definition or {})
        self.indicators: dict[str, Any] = {}
        for name, spec in self.definition["indicators"].items():
            source = self.data.close
            kind = spec["type"]
            period = spec["period"]
            if kind == "sma":
                self.indicators[name] = bt.ind.SMA(source, period=period)
            elif kind == "ema":
                self.indicators[name] = bt.ind.EMA(source, period=period)
            elif kind == "rsi":
                self.indicators[name] = bt.ind.RSI(source, period=period)
        self.entry_price: float | None = None

    def notify_order(self, order):
        if order.status != order.Completed:
            return
        if order.isbuy():
            self.entry_price = float(order.executed.price)
        elif order.issell():
            self.entry_price = None

    def next(self):
        if self.position:
            if self._risk_exit() or self._matches(self.definition["exit"]):
                self.close()
        elif self._matches(self.definition["entry"]):
            self.buy()

    def _risk_exit(self) -> bool:
        if not self.entry_price:
            return False
        change = float(self.data.close[0]) / self.entry_price - 1
        risk = self.definition.get("risk", {})
        return (
            (risk.get("stop_loss_pct") is not None and change <= -float(risk["stop_loss_pct"]))
            or (risk.get("take_profit_pct") is not None and change >= float(risk["take_profit_pct"]))
        )

    def _matches(self, group: dict[str, Any]) -> bool:
        if "all" in group:
            return bool(group["all"]) and all(self._condition(item) for item in group["all"])
        return bool(group.get("any")) and any(self._condition(item) for item in group.get("any", []))

    def _value(self, operand: Any, ago: int = 0) -> float:
        if isinstance(operand, (int, float)):
            return float(operand)
        if operand == "close":
            return float(self.data.close[ago])
        return float(self.indicators[operand][ago])

    def _condition(self, condition: dict[str, Any]) -> bool:
        left, right, op = condition["left"], condition["right"], condition["op"]
        current_left, current_right = self._value(left), self._value(right)
        if op == "crosses_above":
            return self._value(left, -1) <= self._value(right, -1) and current_left > current_right
        if op == "crosses_below":
            return self._value(left, -1) >= self._value(right, -1) and current_left < current_right
        return {
            ">": current_left > current_right,
            ">=": current_left >= current_right,
            "<": current_left < current_right,
            "<=": current_left <= current_right,
            "==": current_left == current_right,
            "!=": current_left != current_right,
        }[op]
