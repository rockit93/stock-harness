---
name: backtest-analysis
description: Create, validate, save, edit, run, compare, and review Stock Harness JSON backtest strategies. Use when a user asks the model to turn a trading idea into testable rules, create a new backtest strategy, run a backtest, tune parameters, compare strategy results, or assess overfitting and risk.
---

# Backtest Analysis

Use the Stock Harness API client from `$stock-harness-api`. Read [references/json-strategy.md](references/json-strategy.md) before generating a strategy definition.

## Create a strategy

1. Translate the user's idea into explicit indicators, entry conditions, exit conditions, and optional risk rules.
2. Do not invent unsupported indicators or operators.
3. Call `POST /backtest-strategies/validate` with `{ "definition": ... }`.
4. Fix validation errors before saving.
5. Show the strategy rules in plain language and obtain explicit user intent before persisting when the request was exploratory.
6. Call `POST /backtest-strategies` with `name`, `description`, and `definition` when the user asked to create or save it.

## Run and review

1. Call `GET /strategies` and use the returned key, including `custom:<id>` for saved JSON strategies.
2. Call `POST /backtest` with market, symbol, dates, adjustment, strategy key, cash, and commission.
3. Review total return against buy-and-hold, annualized return, maximum drawdown, Sharpe ratio, number of closed trades, and sample duration.
4. State that the engine currently omits slippage, market impact, and detailed exchange rules.
5. Do not characterize one in-sample result as a reliable edge. Recommend out-of-sample or walk-forward testing for parameter selection.

## Safety

- Generate JSON only; never create or execute user-supplied Python strategy code.
- Keep indicator periods between 2 and 500 and define at most 20 indicators.
- Avoid tuning many parameters against one symbol and one date range.
- Never imply guaranteed returns or place live trades.
