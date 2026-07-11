# JSON strategy DSL

## Definition

```json
{
  "indicators": {
    "fast": { "type": "sma", "period": 10 },
    "slow": { "type": "sma", "period": 30 },
    "momentum": { "type": "rsi", "period": 14 }
  },
  "entry": {
    "all": [
      { "left": "fast", "op": "crosses_above", "right": "slow" },
      { "left": "momentum", "op": ">", "right": 50 }
    ]
  },
  "exit": {
    "any": [
      { "left": "fast", "op": "crosses_below", "right": "slow" },
      { "left": "momentum", "op": ">=", "right": 75 }
    ]
  },
  "risk": {
    "stop_loss_pct": 0.08,
    "take_profit_pct": 0.2
  }
}
```

## Supported values

- Indicators: `sma`, `ema`, `rsi` with integer `period` from 2 through 500.
- Operands: an indicator name, `close`, or a numeric constant.
- Operators: `>`, `>=`, `<`, `<=`, `==`, `!=`, `crosses_above`, `crosses_below`.
- Condition groups: use exactly one of `all` or `any` for each entry and exit group.
- Risk values: optional `stop_loss_pct` and `take_profit_pct`, each greater than 0 and less than 1.

An empty condition group never matches. The strategy is long-only: it buys when the entry group matches and closes the position when the exit group or a risk threshold matches.

## API

- Validate: `POST /backtest-strategies/validate` with `{ "definition": {...} }`.
- Create: `POST /backtest-strategies` with `name`, `description`, `definition`.
- List: `GET /backtest-strategies` or `GET /strategies`.
- Update: `PUT /backtest-strategies/:id` with the complete strategy body.
- Delete: `DELETE /backtest-strategies/:id`.
- Run: `POST /backtest` using the saved key `custom:<id>`.
