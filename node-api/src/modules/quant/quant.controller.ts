import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository } from "../settings/settings.repository";
import { PythonCoreService } from "./python-core.service";

@UseGuards(AuthGuard)
@Controller()
export class QuantController {
  constructor(
    @Inject(PythonCoreService) private readonly pythonCore: PythonCoreService,
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
  ) {}

  @Get("strategies")
  strategies() {
    return this.pythonCore.strategies();
  }

  @Post("bars")
  bars(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pythonCore.bars(this.withDataSourceSettings(req, body));
  }

  @Post("symbols/lookup")
  lookupSymbols(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pythonCore.lookupSymbols(this.withDataSourceSettings(req, body));
  }

  @Post("backtest")
  backtest(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pythonCore.backtest(this.withDataSourceSettings(req, body));
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
