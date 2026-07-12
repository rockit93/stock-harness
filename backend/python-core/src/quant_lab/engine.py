from __future__ import annotations

from dataclasses import dataclass

import backtrader as bt
import numpy as np
import pandas as pd

from .metrics import BacktestStats, annualized_return, max_drawdown, sharpe_ratio
from .strategies import StrategySpec


class TradeRecorder(bt.Analyzer):
    def start(self):
        self.rows = []

    def notify_trade(self, trade):
        if not trade.isclosed:
            return
        cost_basis = abs(trade.price * trade.size)
        self.rows.append(
            {
                "entry_bar": trade.baropen,
                "exit_bar": trade.barclose,
                "entry_date": bt.num2date(trade.dtopen).date().isoformat(),
                "exit_date": bt.num2date(trade.dtclose).date().isoformat(),
                "entry_price": trade.price,
                "exit_price": trade.data.close[0],
                "size": trade.size,
                "pnl": trade.pnlcomm,
                "pnl_pct": 0.0 if cost_basis == 0 else trade.pnlcomm / cost_basis,
            }
        )

    def get_analysis(self):
        return self.rows


class ValueRecorder(bt.Analyzer):
    def start(self):
        self.rows = []

    def next(self):
        dt = self.strategy.datetime.datetime(0)
        self.rows.append((dt, float(self.strategy.broker.getvalue())))

    def get_analysis(self):
        return self.rows


class OrderRecorder(bt.Analyzer):
    def start(self):
        self.rows = []

    def notify_order(self, order):
        if order.status != order.Completed:
            return
        self.rows.append({
            "date": bt.num2date(order.executed.dt).date().isoformat(),
            "side": "buy" if order.isbuy() else "sell",
            "price": float(order.executed.price),
            "size": abs(float(order.executed.size)),
            "value": abs(float(order.executed.value)),
            "commission": float(order.executed.comm),
        })

    def get_analysis(self):
        return self.rows


@dataclass(frozen=True)
class BacktestResult:
    stats: BacktestStats
    equity: pd.Series
    benchmark_equity: pd.Series
    drawdown: pd.Series
    trades: pd.DataFrame
    orders: pd.DataFrame


def _equity_from_analyzer(cerebro: bt.Cerebro, result, index: pd.Index) -> pd.Series:
    values = result.analyzers.value.get_analysis()
    if values:
        series = pd.Series(
            [value for _, value in values],
            index=pd.to_datetime([dt for dt, _ in values]),
            dtype=float,
        )
        return series.reindex(index).ffill().bfill()

    broker_value = float(cerebro.broker.getvalue())
    return pd.Series([broker_value] * len(index), index=index, dtype=float)


def _prepare_bars(bars: pd.DataFrame) -> pd.DataFrame:
    if bars.empty:
        raise ValueError("backtest data is empty")

    required = ["open", "high", "low", "close", "volume"]
    missing = [column for column in required if column not in bars.columns]
    if missing:
        raise ValueError(f"backtest data is missing columns: {', '.join(missing)}")

    prepared = bars.copy().sort_index()
    prepared.index = pd.to_datetime(prepared.index)
    for column in required:
        prepared[column] = pd.to_numeric(prepared[column], errors="coerce")

    invalid_prices = ~np.isfinite(prepared[["open", "high", "low", "close"]]).all(axis=1)
    invalid_prices |= (prepared[["open", "high", "low", "close"]] <= 0).any(axis=1)
    if invalid_prices.any():
        first_bad_date = prepared.index[invalid_prices][0].date().isoformat()
        raise ValueError(f"backtest data contains non-positive or invalid prices, first bad date: {first_bad_date}")

    prepared["volume"] = prepared["volume"].replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return prepared


def run_backtest(
    bars: pd.DataFrame,
    strategy_spec: StrategySpec,
    strategy_params: dict,
    cash: float,
    commission: float,
) -> BacktestResult:
    if cash <= 0:
        raise ValueError("cash must be greater than 0")
    if commission < 0:
        raise ValueError("commission must be greater than or equal to 0")

    bars = _prepare_bars(bars)
    data = bt.feeds.PandasData(dataname=bars)
    cerebro = bt.Cerebro()
    cerebro.adddata(data)
    cerebro.addstrategy(strategy_spec.strategy_cls, **strategy_params)
    cerebro.broker.setcash(cash)
    cerebro.broker.setcommission(commission=commission)
    cerebro.addsizer(bt.sizers.PercentSizer, percents=95)
    cerebro.addanalyzer(ValueRecorder, _name="value")
    cerebro.addanalyzer(TradeRecorder, _name="trades")
    cerebro.addanalyzer(OrderRecorder, _name="orders")

    runs = cerebro.run()
    strategy = runs[0]

    equity = _equity_from_analyzer(cerebro, strategy, bars.index)

    benchmark_returns = bars["close"].pct_change().fillna(0.0)
    benchmark_equity = cash * (1 + benchmark_returns).cumprod()
    drawdown = (equity / equity.cummax().replace(0, np.nan) - 1).fillna(0.0)

    trades = pd.DataFrame(strategy.analyzers.trades.get_analysis())
    if trades.empty:
        trades = pd.DataFrame(columns=["entry_bar", "exit_bar", "entry_price", "exit_price", "size", "pnl", "pnl_pct"])
    orders = pd.DataFrame(strategy.analyzers.orders.get_analysis())
    if orders.empty:
        orders = pd.DataFrame(columns=["date", "side", "price", "size", "value", "commission"])

    win_rate = 0.0 if trades.empty else float((trades["pnl"] > 0).mean())
    stats = BacktestStats(
        start=bars.index.min().date().isoformat(),
        end=bars.index.max().date().isoformat(),
        total_return=float(equity.iloc[-1] / cash - 1),
        benchmark_return=float(benchmark_equity.iloc[-1] / cash - 1),
        annualized_return=annualized_return(equity),
        max_drawdown=max_drawdown(equity),
        sharpe=sharpe_ratio(equity),
        trade_count=int(len(trades)),
        win_rate=win_rate,
        final_equity=float(equity.iloc[-1]),
    )

    return BacktestResult(
        stats=stats,
        equity=equity,
        benchmark_equity=benchmark_equity,
        drawdown=drawdown,
        trades=trades,
        orders=orders,
    )
