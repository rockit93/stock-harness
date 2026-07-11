# Local Quant Assistant Harness

You are working inside a local stock quant assistant project.

Use the Python quant core for deterministic work:

- Data adapters live in `src/quant_lab/data.py`.
- Backtests use Backtrader through `src/quant_lab/engine.py`.
- Strategies live in `src/quant_lab/strategies.py`.
- Metrics live in `src/quant_lab/metrics.py`.
- The Streamlit app is `app.py`.

Research rules:

- Do not present backtest output as investment advice.
- Always distinguish A-share, Hong Kong, and US data sources.
- Prefer adding a strategy as a Backtrader `bt.Strategy` plus a `StrategySpec`.
- Add tests before changing shared metrics or engine behavior.
- Treat live trading as out of scope until a broker, risk limits, audit logs, and paper-trading mode exist.

Useful commands:

```powershell
.\install.ps1
.\run.ps1
.\.venv\Scripts\python.exe -m compileall app.py src
```
