import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository } from "../settings/settings.repository";
import { PythonCoreService } from "./python-core.service";
import { BacktestStrategiesRepository } from "../backtest-strategies/backtest-strategies.repository";
import { SymbolCacheRepository, CachedSymbol } from "./symbol-cache.repository";
import { HttpDataSourceService } from "./http-data-source.service";
import { HttpDataSource } from "../settings/settings.repository";

@UseGuards(AuthGuard)
@Controller()
export class QuantController {
  constructor(
    @Inject(PythonCoreService) private readonly pythonCore: PythonCoreService,
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(BacktestStrategiesRepository) private readonly customStrategies: BacktestStrategiesRepository,
    @Inject(SymbolCacheRepository) private readonly symbolCache: SymbolCacheRepository,
    @Inject(HttpDataSourceService) private readonly httpSources: HttpDataSourceService,
  ) {}

  @Get("strategies")
  async strategies(@Req() req: AuthenticatedRequest) {
    const builtins = await this.pythonCore.strategies() as Array<Record<string, unknown>>;
    return [
      ...builtins.map((item) => ({ ...item, source: "builtin" })),
      ...this.customStrategies.list(Number(req.user.sub)),
    ];
  }

  @Post("bars")
  async bars(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = this.asRecord(body);
    const custom = await this.httpSources.request(Number(req.user.sub), "bars", input);
    if (custom.data) return { ...(custom.data as object), source: custom.source };
    return this.pythonCore.bars(this.withDataSourceSettings(req, body));
  }

  @Post("symbols/lookup")
  async lookupSymbols(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const input = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
    const market = String(input.market ?? "");
    const keyword = String(input.keyword ?? "").trim();
    const limit = Math.max(1, Math.min(Number(input.limit ?? 8), 20));
    const cached = this.symbolCache.search(market, keyword, limit);
    const exact = cached.some((item) => item.symbol.toUpperCase() === keyword.toUpperCase() || item.name === keyword);
    if (exact || cached.length >= limit) return { symbols: cached, cached: true };

    const custom = await this.httpSources.request(Number(req.user.sub), "symbols", input);
    const payload = custom.data ? custom.data as { symbols?: CachedSymbol[] } : await this.pythonCore.lookupSymbols(this.withDataSourceSettings(req, body)) as { symbols?: CachedSymbol[] };
    const fresh = (payload.symbols ?? []).filter((item) => item.market && item.symbol && item.name);
    this.symbolCache.upsert(fresh);
    const merged = [...cached, ...fresh].filter((item, index, list) => list.findIndex((other) => other.market === item.market && other.symbol === item.symbol) === index).slice(0, limit);
    return { ...payload, symbols: merged, cached: false };
  }

  @Post("data-sources/test")
  testHttpDataSource(@Body() body: HttpDataSource & { testInput?: Record<string, unknown> }) {
    return this.httpSources.test(body, body.testInput ?? { market: "A Share", symbol: "600519", start: "2026-01-01", end: "2026-01-31", interval: "1d" });
  }

  @Post("fundamentals")
  async fundamentals(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const custom = await this.httpSources.request(Number(req.user.sub), "fundamentals", this.asRecord(body));
    if (custom.data) return { ...(custom.data as object), source: custom.source };
    return this.pythonCore.fundamentals(this.withDataSourceSettings(req, body));
  }

  @Post("backtest")
  backtest(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const payload = this.withDataSourceSettings(req, body) as Record<string, unknown>;
    const custom = this.customStrategies.getByKey(Number(req.user.sub), String(payload.strategy ?? ""));
    if (custom) payload.strategy_definition = custom.definition;
    return this.pythonCore.backtest(payload);
  }

  private withDataSourceSettings(req: AuthenticatedRequest, body: unknown) {
    const settings = this.settings.get(Number(req.user.sub));
    const payload = typeof body === "object" && body !== null && !Array.isArray(body) ? body : {};
    return {
      ...payload,
      data_source: settings.dataSource,
      futu_host: settings.futuHost,
      futu_port: settings.futuPort,
      provider_chains: Object.fromEntries(Object.entries(settings.providerChains).map(([market, chain]) => [market, chain.filter((key) => ["akshare", "tushare", "baostock", "futu", "yfinance", "sec_edgar"].includes(key))])),
      tushare_token: this.settings.getTushareToken(Number(req.user.sub)),
    };
  }

  private asRecord(body: unknown) { return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {}; }
}
