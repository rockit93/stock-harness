from __future__ import annotations

from dataclasses import dataclass

import backtrader as bt
import pandas as pd

from .metrics import BacktestStats, annualized_return, max_drawdown, sharpe_ratio
from .strategies import StrategySpec


class TradeRecorder(bt.Analyzer):
    def start(self):
        self.rows = []

    def notify_trade(self, trade):
        if not trade.isclosed:
            return
        self.rows.append(
            {
                "entry_bar": trade.baropen,
                "exit_bar": trade.barclose,
                "entry_price": trade.price,
                "exit_price": trade.data.close[0],
                "size": trade.size,
                "pnl": trade.pnlcomm,
                "pnl_pct": 0.0 if trade.price == 0 else trade.pnlcomm / abs(trade.price * trade.size),
            }
        )

    def get_analysis(self):
        return self.rows


@dataclass(frozen=True)
class BacktestResult:
    stats: BacktestStats
    equity: pd.Series
    benchmark_equity: pd.Series
    drawdown: pd.Series
    trades: pd.DataFrame


def _equity_from_analyzer(cerebro: bt.Cerebro, result, index: pd.Index) -> pd.Series:
    values = result.analyzers.value.get_analysis()
    if isinstance(values, dict):
        series = pd.Series(values, dtype=float)
        series.index = pd.to_datetime(series.index)
        return series.reindex(index).ffill().dropna()

    broker_value = float(cerebro.broker.getvalue())
    return pd.Series([broker_value] * len(index), index=index, dtype=float)


def run_backtest(
    bars: pd.DataFrame,
    strategy_spec: StrategySpec,
    strategy_params: dict,
    cash: float,
    commission: float,
) -> BacktestResult:
    data = bt.feeds.PandasData(dataname=bars)
    cerebro = bt.Cerebro()
    cerebro.adddata(data)
    cerebro.addstrategy(strategy_spec.strategy_cls, **strategy_params)
    cerebro.broker.setcash(cash)
    cerebro.broker.setcommission(commission=commission)
    cerebro.addsizer(bt.sizers.PercentSizer, percents=95)
    cerebro.addanalyzer(bt.analyzers.TimeReturn, _name="returns", timeframe=bt.TimeFrame.Days)
    cerebro.addanalyzer(bt.analyzers.TimeReturn, _name="value", timeframe=bt.TimeFrame.Days, fund=False)
    cerebro.addanalyzer(TradeRecorder, _name="trades")

    runs = cerebro.run()
    strategy = runs[0]

    returns = pd.Series(strategy.analyzers.returns.get_analysis(), dtype=float)
    returns.index = pd.to_datetime(returns.index)
    returns = returns.reindex(bars.index).fillna(0.0)
    equity = cash * (1 + returns).cumprod()

    benchmark_returns = bars["close"].pct_change().fillna(0.0)
    benchmark_equity = cash * (1 + benchmark_returns).cumprod()
    drawdown = equity / equity.cummax() - 1

    trades = pd.DataFrame(strategy.analyzers.trades.get_analysis())
    if trades.empty:
        trades = pd.DataFrame(columns=["entry_bar", "exit_bar", "entry_price", "exit_price", "size", "pnl", "pnl_pct"])

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
    )
