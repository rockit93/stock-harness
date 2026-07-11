# Stock Harness API reference

Base URL: `http://127.0.0.1:8787`. JSON is used for request and response bodies. Protected endpoints require `x-jwt-token: <JWT>`.

## Public

| Method | Path | Body |
|---|---|---|
| GET | `/` | none |
| GET | `/health` | none |
| POST | `/auth/register` | `username`, `password`, optional `rememberMe` |
| POST | `/auth/login` | `username`, `password`, optional `rememberMe` |

## User and quant

| Method | Path | Purpose / body |
|---|---|---|
| GET | `/auth/me` | Current user |
| GET | `/strategies` | Available backtest strategies |
| POST | `/symbols/lookup` | Symbol search; typically `query` |
| POST | `/bars` | OHLCV bars; typically `symbol`, market/date options |
| POST | `/fundamentals` | Fundamental data for a symbol |
| POST | `/backtest` | Run a backtest with the selected strategy and parameters |

Custom JSON backtest strategies use `GET|POST /backtest-strategies`, `POST /backtest-strategies/validate`, and `PUT|DELETE /backtest-strategies/:id`. Saved strategies appear in `GET /strategies` with keys such as `custom:12`; pass that key as `strategy` to `/backtest`.

Quant request fields are passed to Python Core. The Node API injects the current user's configured data source, Futu host, and Futu port; do not override those fields in model-generated payloads.

## Subscriptions and labels

| Method | Path | Body |
|---|---|---|
| GET, POST | `/subscriptions` | POST: `market`, `symbol`, optional `stockName`, `name`, `remark` |
| DELETE | `/subscriptions/:id` | none |
| GET, POST | `/label-strategies` | POST: strategy definition |
| GET | `/label-strategies/templates` | none |
| POST | `/label-strategies/templates/:key/copy` | none |
| POST | `/label-strategies/:id/run` | none |
| DELETE | `/label-strategies/:id` | none |
| GET | `/label-strategies/bindings` | none |
| GET | `/label-strategies/labels` | none |
| POST | `/label-strategies/bindings` | binding definition |
| POST | `/label-strategies/bindings/:id/run` | none |
| DELETE | `/label-strategies/bindings/:id` | none |

## Agents, skills, and plugins

| Method | Path | Body |
|---|---|---|
| GET, POST | `/agent-roles` | POST: `name`, `responsibility`, `systemPrompt` |
| PUT | `/agent-roles/:id/capabilities` | `skillIds`, `pluginIds` |
| DELETE | `/agent-roles/:id` | none |
| POST | `/pi/chat` | `roleId`, `message`; returns NDJSON |
| GET, POST | `/pi/skills` | POST: `name`, `description`, `content` |
| DELETE | `/pi/skills/:id` | none |
| GET, POST | `/pi/plugins` | POST: `name`, `description`, `sourceUrl`, `code` |
| PUT, DELETE | `/pi/plugins/:id` | PUT accepts plugin fields |
| POST | `/pi/plugins/:id/publish` | none |
| POST | `/pi/plugins/:id/offline` | none |

## Settings

Data source endpoints: `GET|PUT /settings/data-source`, `POST /settings/data-source/test-connection`.

Model endpoints: `GET|PUT /settings/model`, `GET /settings/model/available`, `POST /settings/model/test-connection`, `GET|POST /settings/models`, `PUT|DELETE /settings/models/:id`, and `POST /settings/models/test-connection`.

Settings can contain secret references. Never echo API key values; prefer environment-variable references such as `apiKeyRef`.
