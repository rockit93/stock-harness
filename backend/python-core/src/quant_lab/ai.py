from __future__ import annotations

import json
import urllib.error
import urllib.request

from .metrics import BacktestStats, format_pct


def ask_ollama(model: str, prompt: str, host: str = "http://127.0.0.1:11434") -> str:
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode("utf-8")
    request = urllib.request.Request(
        f"{host.rstrip('/')}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError("无法连接 Ollama。请确认 Ollama 已启动，并且模型已经下载。") from exc
    return payload.get("response", "").strip()


def build_research_prompt(symbol: str, market: str, strategy: str, stats: BacktestStats) -> str:
    return f"""
你是一个谨慎的量化研究助手。请用中文回答。

这是本地回测结果，不构成投资建议。

市场: {market}
标的: {symbol}
策略: {strategy}
区间: {stats.start} 到 {stats.end}
策略总收益: {format_pct(stats.total_return)}
买入持有收益: {format_pct(stats.benchmark_return)}
年化收益: {format_pct(stats.annualized_return)}
最大回撤: {format_pct(stats.max_drawdown)}
夏普比率: {stats.sharpe:.2f}
交易次数: {stats.trade_count}
胜率: {format_pct(stats.win_rate)}

请输出:
1. 这个结果是否值得继续研究
2. 主要风险和可能的过拟合点
3. 下一步应该补充哪些检验
4. 具体的后续开发任务
""".strip()
