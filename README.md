# Local Quant Assistant

This is a local, extensible stock quant assistant for Windows. It covers A-shares, Hong Kong stocks, and US stocks.

The project uses open-source components:

- Backtrader for the backtest engine
- AkShare for A-share daily data
- yfinance for Hong Kong and US daily data
- Streamlit for the local UI
- Ollama as an optional local AI research note backend
- Pi framework project context and skill package skeleton under `.pi/` and `pi-harness/`

## Start

Open PowerShell in this folder:

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-07-11\r\outputs\quant-lab
powershell -ExecutionPolicy Bypass -File .\install.ps1
powershell -ExecutionPolicy Bypass -File .\run.ps1
```

Then open:

```text
http://127.0.0.1:8501
```

## Recommended Python

Python 3.11 or 3.12 is recommended. The installer tries `py -3.11`, `py -3.12`, the bundled Codex Python, then `python`.

If the default Python is too new and package installation fails, install Miniconda and run:

```powershell
conda create -n quant python=3.11 -y
conda activate quant
pip install -r requirements.txt
streamlit run app.py
```

## Project Layout

```text
app.py                         Streamlit UI
src/quant_lab/
  data.py                      A-share, Hong Kong, and US data adapters
  engine.py                    Backtrader execution entrypoint
  strategies.py                Strategy registry
  metrics.py                   Metrics helpers
  ai.py                        Local Ollama client
.pi/AGENTS.md                  Pi project context
pi-harness/                    Pi skill and prompt package skeleton
```

## Add a Strategy

Add a Backtrader strategy to `src/quant_lab/strategies.py`, then register it:

```python
STRATEGIES["my_strategy"] = StrategySpec(
    key="my_strategy",
    label="My Strategy",
    strategy_cls=MyStrategy,
    default_params={"period": 20},
)
```

The Streamlit sidebar automatically exposes parameters from `default_params`.

## Optional Ollama Setup

Install Ollama, start it, then pull local models:

```powershell
ollama pull qwen2.5-coder:14b
ollama pull glm4:9b
```

Enable local Ollama in the app sidebar and use one of those model names.

## Pi Harness

Pi project instructions are in:

```text
.pi/AGENTS.md
```

The package skeleton is in:

```text
pi-harness/
```

It contains:

- `skills/quant-research/SKILL.md`
- `prompts/review-backtest.md`
- `prompts/add-strategy.md`

You can evolve this into a full Pi package as your local agent workflow grows.

## Scope

This project is for research and learning. It is not investment advice. Before live trading, add data validation, slippage modeling, risk controls, paper trading, audit logs, and broker integration.
