import { Module } from "@nestjs/common";
import { QuantModule } from "../quant/quant.module";
import { AuthModule } from "../auth/auth.module";
import { BacktestStrategiesController } from "./backtest-strategies.controller";
import { BacktestDatasetsController } from "./backtest-datasets.controller";
import { BacktestDatasetsRepository } from "./backtest-datasets.repository";

@Module({
  imports: [AuthModule, QuantModule],
  controllers: [BacktestStrategiesController, BacktestDatasetsController],
  providers: [BacktestDatasetsRepository],
})
export class BacktestStrategiesModule {}
