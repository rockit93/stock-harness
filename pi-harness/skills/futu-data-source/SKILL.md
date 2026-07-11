# Futu Data Source Skill

Use this skill when adding, debugging, or extending Futu OpenAPI data access in the local quant assistant.

## Context

The app supports Futu as an optional daily OHLCV data source through `futu-api`.

Relevant files:

- `backend/python-core/src/quant_lab/data.py`
- `backend/python-core/app.py`
- `backend/python-core/requirements.txt`

## Requirements

- Keep Futu optional. The app must still run with the default AkShare/Yahoo data path.
- Do not require Futu OpenD during import time.
- Import `futu` only inside Futu-specific functions.
- Use `OpenQuoteContext.request_history_kline` for historical daily bars.
- Close `OpenQuoteContext` in a `finally` block.
- Normalize all data sources to columns: `open`, `high`, `low`, `close`, `volume`.

## Symbol Rules

- A-share: infer `SH.` for symbols starting with `5`, `6`, or `9`; otherwise use `SZ.`
- Hong Kong: use `HK.00700` style
- US: use `US.AAPL` style

## Safety

- Surface clear Chinese error messages when Futu is missing, OpenD is not running, or permissions are insufficient.
- Do not add trading APIs without explicit approval.
- Do not store Futu credentials in the repo.
