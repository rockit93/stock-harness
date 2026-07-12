import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { BacktestDatasetBody, BacktestDatasetsRepository, DatasetImportBody } from "./backtest-datasets.repository";
import { PythonCoreService } from "../quant/python-core.service";
import { BacktestStrategiesRepository } from "./backtest-strategies.repository";

@UseGuards(AuthGuard)
@Controller("backtest-datasets")
export class BacktestDatasetsController {
  constructor(@Inject(BacktestDatasetsRepository) private readonly datasets: BacktestDatasetsRepository, @Inject(PythonCoreService) private readonly pythonCore: PythonCoreService, @Inject(BacktestStrategiesRepository) private readonly strategies: BacktestStrategiesRepository) {}
  @Get() list(@Req() req: AuthenticatedRequest) { return this.datasets.list(Number(req.user.sub)); }
  @Post() create(@Req() req: AuthenticatedRequest, @Body() body: BacktestDatasetBody) { return this.datasets.create(Number(req.user.sub), body); }
  @Put(":id") update(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: BacktestDatasetBody) { return this.datasets.update(Number(req.user.sub), Number(id), body); }
  @Post(":id/import") importRows(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: DatasetImportBody) { return this.datasets.importRows(Number(req.user.sub), Number(id), body); }
  @Get(":id/rows") rows(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Query("page") page: string, @Query("pageSize") pageSize: string) { return this.datasets.rows(Number(req.user.sub), Number(id), Number(page), Number(pageSize)); }
  @Post(":id/backtest") backtest(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    const userId = Number(req.user.sub); const symbol = String(body.symbol || "");
    const payload: Record<string, unknown> = { ...body, dataset_bars: this.datasets.bars(userId, Number(id), symbol) };
    const custom = this.strategies.getByKey(userId, String(body.strategy || ""));
    if (custom) payload.strategy_definition = custom.definition;
    return this.pythonCore.backtest(payload);
  }
  @Delete(":id") remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) { this.datasets.remove(Number(req.user.sub), Number(id)); return { ok: true }; }
}
