# Quant Research Skill

Use this skill when developing, reviewing, or extending the local quant assistant.

## Workflow

1. Identify the target market: A-share, Hong Kong, or US.
2. Identify which Pi role should own the task, such as market observer, strategy researcher, backtest executor, risk reviewer, or report writer.
3. Check data adapter behavior before changing strategy logic.
4. Implement strategies as Backtrader strategies in `src/quant_lab/strategies.py`.
5. Register strategies with `StrategySpec`.
6. Run syntax checks and, when possible, a small deterministic backtest.
7. Report research limitations clearly.

## Guardrails

- Never call a backtest result a guaranteed edge.
- Do not add live trading without explicit user approval.
- Do not mix adjusted A-share data with unadjusted Yahoo data in one portfolio without documenting the normalization.
- Prefer small, auditable strategies over opaque model predictions.
- Do not route every task to one generic agent. Use the configured Pi role best suited for the work.

## Extension Ideas

- Add portfolio-level multi-asset backtesting.
- Add factor research with IC, rank IC, and grouped returns.
- Add walk-forward tests.
- Add paper trading adapters.
- Add a RAG document store for announcements, filings, and research notes.
