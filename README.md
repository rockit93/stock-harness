# stock-harness

关于股票咨询 / 推荐的本地 agent harness。项目定位是量化研究助手，不是自动荐股或投资建议系统。

这是一个 Windows 本地可开发的股票量化助手，覆盖 A 股、港股、美股。

开源组件：

- Backtrader: 回测引擎
- AkShare: A 股、港股、美股行情数据
- yfinance: 港股、美股备用行情数据
- Streamlit: 本地中文交互界面
- Ollama: 可选本地 AI 研究笔记
- Pi framework harness: `.pi/` 和 `pi-harness/` 项目上下文与 skill 骨架

## 启动

在 PowerShell 里进入项目目录：

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-07-11\r\outputs\quant-lab
powershell -ExecutionPolicy Bypass -File .\install.ps1
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

打开：

```text
http://127.0.0.1:8501
```

## 推荐 Python

推荐 Python 3.11 或 3.12。安装脚本会依次尝试 `py -3.11`、`py -3.12`、Codex bundled Python、系统 `python`。

如果系统默认 Python 太新导致依赖安装失败，建议用 Miniconda：

```powershell
conda create -n quant python=3.11 -y
conda activate quant
pip install -r requirements.txt
streamlit run app.py
```

## 项目结构

```text
app.py                         Streamlit 中文 UI
src/quant_lab/
  data.py                      A 股、港股、美股数据适配器
  engine.py                    Backtrader 回测入口
  strategies.py                策略注册表
  metrics.py                   指标工具
  ai.py                        本地 Ollama 客户端
.pi/AGENTS.md                  Pi 项目上下文
pi-harness/                    Pi skill 和 prompt 包骨架
```

## 添加策略

在 `src/quant_lab/strategies.py` 里新增 Backtrader 策略，然后注册：

```python
STRATEGIES["my_strategy"] = StrategySpec(
    key="my_strategy",
    label="My Strategy",
    strategy_cls=MyStrategy,
    default_params={"period": 20},
)
```

Streamlit 侧边栏会自动展示 `default_params` 里的参数。

## Ollama

安装并启动 Ollama 后，拉取本地模型：

```powershell
ollama pull qwen2.5-coder:14b
ollama pull glm4:9b
```

在页面左侧开启“启用本地 Ollama”，模型名称填写上述模型之一。

## Pi Harness

Pi 项目指令：

```text
.pi/AGENTS.md
```

Pi 包骨架：

```text
pi-harness/
```

包含：

- `skills/quant-research/SKILL.md`
- `prompts/review-backtest.md`
- `prompts/add-strategy.md`

## 范围

本项目仅用于量化研究和学习，不构成投资建议。实盘前必须补齐数据校验、滑点建模、风控、模拟盘、审计日志和券商接口。
