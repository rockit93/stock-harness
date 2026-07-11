# Local Quant Assistant Harness

You are working inside a local stock quant assistant project.

Pi is the runtime agent orchestrator for this project, not just a documentation folder. User dialogue, strategy requests, dashboard analysis, scheduled tasks, and report generation should be routed through Pi roles/subagents before calling the Node API or Python Core.

Use the Python quant core for deterministic work:

- Data adapters live in `src/quant_lab/data.py`.
- Backtests use Backtrader through `src/quant_lab/engine.py`.
- Strategies live in `src/quant_lab/strategies.py`.
- Metrics live in `src/quant_lab/metrics.py`.
- The Streamlit app is `app.py`.
- Futu OpenD data source support lives in `src/quant_lab/data.py` and must remain optional.
- Node API lives in `node-api/` and uses NestJS + Fastify.
- Vue Web lives in `vue-web/` and uses Vite.

Research rules:

- Do not present backtest output as investment advice.
- Always distinguish A-share, Hong Kong, and US data sources.
- Prefer adding a strategy as a Backtrader `bt.Strategy` plus a `StrategySpec`.
- Add tests before changing shared metrics or engine behavior.
- Import `futu` lazily inside Futu-specific functions so default workflows do not require OpenD.
- Node auth must read JWTs from `x-jwt-token`.
- Keep user persistence behind a repository so SQLite can migrate to MongoDB later.
- Pi roles are managed by Node API under `agent_roles`. Treat each role as a subagent with a name, responsibility, and system prompt.
- Future scheduled jobs should reference a Pi role so each recurring task has an explicit owner.
- Treat live trading as out of scope until a broker, risk limits, audit logs, and paper-trading mode exist.

Useful commands:

```powershell
.\install.ps1
.\run.ps1
.\.venv\Scripts\python.exe -m compileall app.py src
```
