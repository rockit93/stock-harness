import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository } from "../settings/settings.repository";
import { PythonCoreService } from "./python-core.service";
import { BacktestStrategiesRepository } from "../backtest-strategies/backtest-strategies.repository";

@UseGuards(AuthGuard)
@Controller()
export class QuantController {
  constructor(
    @Inject(PythonCoreService) private readonly pythonCore: PythonCoreService,
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(BacktestStrategiesRepository) private readonly customStrategies: BacktestStrategiesRepository,
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
  bars(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pythonCore.bars(this.withDataSourceSettings(req, body));
  }

  @Post("symbols/lookup")
  lookupSymbols(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pythonCore.lookupSymbols(this.withDataSourceSettings(req, body));
  }

  @Post("fundamentals")
  fundamentals(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
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
    };
  }
}
