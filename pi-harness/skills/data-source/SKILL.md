# Data Source Skill

Use this skill when adding, debugging, or extending market-data access in the local quant assistant.

## Provider selection

- Treat this as one provider-neutral data-source capability.
- Read the current user's per-market provider chain at runtime.
- Call providers in configured order and fall back to the next provider after a diagnosable failure.
- Futu, AkShare, Tushare Pro, Yahoo Finance, SEC EDGAR, and custom HTTP sources are providers, not separate skills.
- Never silently replace the user's selected route with a preferred provider.

## Normalization

- Normalize symbols for the selected provider only at the adapter boundary.
- Normalize OHLCV results to `open`, `high`, `low`, `close`, and `volume`.
- Preserve market, timezone, adjustment mode, interval, provider, and requested data range in results.

## Provider-specific behavior

- Keep optional providers optional and import their SDKs only inside their adapters.
- When the selected route uses Futu, use the configured OpenD host and port, reuse connections where possible, and close quote contexts reliably.
- Surface clear Chinese errors for missing SDKs, unreachable services, insufficient permissions, and exhausted provider chains.

## Safety

- Do not fabricate market data.
- Do not store provider credentials in the repo.
- Do not add or invoke trading APIs without explicit approval.
