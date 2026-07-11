import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { PythonCoreService } from "../quant/python-core.service";
import { BacktestStrategiesRepository, BacktestStrategyBody } from "./backtest-strategies.repository";

@UseGuards(AuthGuard)
@Controller("backtest-strategies")
export class BacktestStrategiesController {
  constructor(
    @Inject(BacktestStrategiesRepository) private readonly strategies: BacktestStrategiesRepository,
    @Inject(PythonCoreService) private readonly pythonCore: PythonCoreService,
  ) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) { return this.strategies.list(Number(req.user.sub)); }

  @Post("validate")
  validate(@Body() body: { definition?: unknown }) { return this.pythonCore.validateStrategy(body.definition); }

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() body: BacktestStrategyBody) {
    await this.pythonCore.validateStrategy(body.definition);
    return this.strategies.create(Number(req.user.sub), body);
  }

  @Put(":id")
  async update(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: BacktestStrategyBody) {
    await this.pythonCore.validateStrategy(body.definition);
    return this.strategies.update(Number(req.user.sub), Number(id), body);
  }

  @Delete(":id")
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.strategies.remove(Number(req.user.sub), Number(id));
    return { ok: true };
  }
}
