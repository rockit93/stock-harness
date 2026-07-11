---
name: stock-harness-api
description: Call the Stock Harness platform HTTP API for health checks, authentication, market data, symbol lookup, fundamentals, backtests, subscriptions, label strategies, agent roles, skills, plugins, and settings. Use whenever a user asks the model to query, create, update, run, or delete data in the Stock Harness platform, or to diagnose its API behavior.
---

# Stock Harness API

Use the bundled client to call the platform API. Read [references/api.md](references/api.md) before choosing an endpoint or constructing a request body.

## Workflow

1. Confirm the local Node API is reachable at `STOCK_HARNESS_API_BASE` or `http://127.0.0.1:8787`.
2. Use `STOCK_HARNESS_TOKEN` when already available. Never print, persist, or commit tokens or passwords.
3. For unauthenticated local development, log in only when the user supplied credentials or they are already available through environment variables.
4. Prefer read-only requests when the user's intent is informational.
5. Before deleting data, publishing/offlining plugins, changing settings, running a strategy/backtest, or making another consequential mutation, ensure the user explicitly requested that action.
6. Call the API with `scripts/stock_harness_api.py`. Return the relevant result and explain API errors without exposing secrets.

## Client

```powershell
python scripts/stock_harness_api.py GET /health
python scripts/stock_harness_api.py GET /subscriptions --token-env STOCK_HARNESS_TOKEN
python scripts/stock_harness_api.py POST /symbols/lookup --json '{"query":"AAPL"}'
```

The client reads these environment variables:

- `STOCK_HARNESS_API_BASE`: API origin; defaults to `http://127.0.0.1:8787`.
- `STOCK_HARNESS_TOKEN`: JWT sent as `x-jwt-token`.
- `STOCK_HARNESS_USERNAME` and `STOCK_HARNESS_PASSWORD`: optional login credentials used with `--login`.

Use `--stream` for `/pi/chat`, whose response is newline-delimited JSON. Run `--help` for all options.

## Error Handling

- Treat HTTP 401/403 as an authentication or authorization problem; do not retry with guessed credentials.
- Treat connection refusal as a stopped Node API and suggest the repository start script.
- Preserve the server's status code and error message in the report.
- Do not silently retry mutations.
