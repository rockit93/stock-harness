from __future__ import annotations

from datetime import date

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from src.quant_lab.ai import ask_ollama, build_research_prompt
from src.quant_lab.data import Market, load_daily_bars
from src.quant_lab.engine import run_backtest
from src.quant_lab.metrics import format_money, format_pct
from src.quant_lab.strategies import STRATEGIES


st.set_page_config(
    page_title="本地量化助手",
    layout="wide",
    initial_sidebar_state="expanded",
)


MARKETS = {
    "A 股": Market.A_SHARE,
    "港股": Market.HK,
    "美股": Market.US,
}

STRATEGY_LABELS = {
    "ma_cross": "双均线交叉",
    "rsi_mean_reversion": "RSI 均值回归",
}

PARAM_LABELS = {
    "fast": "快均线周期",
    "slow": "慢均线周期",
    "period": "指标周期",
    "lower": "买入阈值",
    "upper": "卖出阈值",
}

SUMMARY_LABELS = {
    "start": "开始日期",
    "end": "结束日期",
    "total_return": "策略总收益",
    "benchmark_return": "买入持有收益",
    "annualized_return": "年化收益",
    "max_drawdown": "最大回撤",
    "sharpe": "夏普比率",
    "trade_count": "交易次数",
    "win_rate": "胜率",
    "final_equity": "期末权益",
}


def price_chart(frame: pd.DataFrame, symbol: str) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(
        go.Candlestick(
            x=frame.index,
            open=frame["open"],
            high=frame["high"],
            low=frame["low"],
            close=frame["close"],
            name="价格",
            increasing_line_color="#1b7f5c",
            decreasing_line_color="#b4232a",
        )
    )
    fig.update_layout(
        title=f"{symbol} 价格走势",
        height=430,
        margin=dict(l=20, r=20, t=48, b=20),
        xaxis_rangeslider_visible=False,
    )
    return fig


def equity_chart(equity: pd.Series, benchmark: pd.Series) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=equity.index, y=equity, name="策略", line=dict(color="#1565c0", width=2)))
    fig.add_trace(go.Scatter(x=benchmark.index, y=benchmark, name="买入持有", line=dict(color="#545454", width=1.5)))
    fig.update_layout(
        title="权益曲线",
        height=360,
        margin=dict(l=20, r=20, t=48, b=20),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    return fig


def drawdown_chart(drawdown: pd.Series) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=drawdown.index,
            y=drawdown * 100,
            name="回撤",
            fill="tozeroy",
            line=dict(color="#b4232a", width=1.4),
        )
    )
    fig.update_layout(
        title="回撤 (%)",
        height=300,
        margin=dict(l=20, r=20, t=48, b=20),
        yaxis_ticksuffix="%",
    )
    return fig


def summary_rows(stats) -> list[dict[str, str]]:
    raw = stats.to_dict()
    rows = []
    for key, label in SUMMARY_LABELS.items():
        value = raw[key]
        if key in {"total_return", "benchmark_return", "annualized_return", "max_drawdown", "win_rate"}:
            display = format_pct(float(value))
        elif key == "final_equity":
            display = format_money(float(value))
        elif key == "sharpe":
            display = f"{float(value):.2f}"
        else:
            display = str(value)
        rows.append({"指标": label, "数值": display})
    return rows


st.title("本地量化助手")

with st.sidebar:
    st.header("市场与标的")
    market_label = st.selectbox("市场", list(MARKETS.keys()), index=0)
    market = MARKETS[market_label]

    default_symbol = {
        Market.A_SHARE: "600519",
        Market.HK: "00700",
        Market.US: "AAPL",
    }[market]
    symbol = st.text_input("股票代码", value=default_symbol, help="示例：A 股 600519，港股 00700，美股 AAPL")
    start = st.date_input("开始日期", value=date(2020, 1, 1))
    end = st.date_input("结束日期", value=date.today())
    adjust = st.selectbox("复权方式", ["qfq", "hfq", "none"], index=0, help="A 股常用 qfq 前复权；港股和美股可保持默认。")

    st.header("回测设置")
    strategy_key = st.selectbox(
        "策略",
        list(STRATEGIES.keys()),
        format_func=lambda key: STRATEGY_LABELS.get(key, STRATEGIES[key].label),
    )
    spec = STRATEGIES[strategy_key]

    params = {}
    for name, value in spec.default_params.items():
        label = PARAM_LABELS.get(name, name)
        if isinstance(value, int):
            params[name] = st.number_input(label, min_value=1, max_value=500, value=value, step=1)
        else:
            params[name] = st.number_input(label, value=float(value), step=0.1)

    cash = st.number_input("初始资金", min_value=1000.0, max_value=100000000.0, value=100000.0, step=10000.0)
    commission_bps = st.number_input("单边手续费 (bps)", min_value=0.0, max_value=200.0, value=3.0, step=0.5)

    st.header("AI 分析")
    enable_ai = st.checkbox("启用本地 Ollama", value=False)
    ollama_model = st.text_input("模型名称", value="qwen2.5-coder:14b")


if start >= end:
    st.warning("开始日期必须早于结束日期。")
    st.stop()

try:
    with st.spinner("正在加载行情数据..."):
        bars = load_daily_bars(
            market=market,
            symbol=symbol,
            start=start,
            end=end,
            adjust="" if adjust == "none" else adjust,
        )

    with st.spinner("正在运行回测..."):
        result = run_backtest(
            bars=bars,
            strategy_spec=spec,
            strategy_params=params,
            cash=cash,
            commission=commission_bps / 10000,
        )
except Exception as exc:
    st.error(str(exc))
    st.stop()


cols = st.columns(6)
cols[0].metric("策略总收益", format_pct(result.stats.total_return))
cols[1].metric("买入持有", format_pct(result.stats.benchmark_return))
cols[2].metric("年化收益", format_pct(result.stats.annualized_return))
cols[3].metric("最大回撤", format_pct(result.stats.max_drawdown))
cols[4].metric("夏普比率", f"{result.stats.sharpe:.2f}")
cols[5].metric("交易次数", str(result.stats.trade_count))

st.plotly_chart(price_chart(bars, symbol), use_container_width=True)

left, right = st.columns([1.2, 1])
with left:
    st.plotly_chart(equity_chart(result.equity, result.benchmark_equity), use_container_width=True)
with right:
    st.plotly_chart(drawdown_chart(result.drawdown), use_container_width=True)

tab_summary, tab_data, tab_trades, tab_ai = st.tabs(["摘要", "行情数据", "交易记录", "AI 分析"])

with tab_summary:
    st.dataframe(summary_rows(result.stats), use_container_width=True, hide_index=True)

with tab_data:
    st.dataframe(bars.tail(500), use_container_width=True, height=420)

with tab_trades:
    if result.trades.empty:
        st.info("当前区间没有已平仓交易。")
    else:
        trades = result.trades.copy()
        trades["pnl"] = trades["pnl"].map(format_money)
        trades["pnl_pct"] = trades["pnl_pct"].map(format_pct)
        trades = trades.rename(
            columns={
                "entry_bar": "开仓 Bar",
                "exit_bar": "平仓 Bar",
                "entry_price": "开仓价",
                "exit_price": "平仓价",
                "size": "数量",
                "pnl": "盈亏",
                "pnl_pct": "收益率",
            }
        )
        st.dataframe(trades, use_container_width=True, height=420)

with tab_ai:
    if not enable_ai:
        st.info("请在左侧边栏启用本地 Ollama。")
    elif st.button("生成研究笔记", use_container_width=True):
        prompt = build_research_prompt(
            symbol=symbol,
            market=market_label,
            strategy=STRATEGY_LABELS.get(strategy_key, spec.label),
            stats=result.stats,
        )
        with st.spinner("正在请求本地 Ollama..."):
            try:
                st.markdown(ask_ollama(ollama_model, prompt))
            except Exception as exc:
                st.error(str(exc))
