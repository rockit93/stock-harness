import { Module } from "@nestjs/common";
import { QuantModule } from "../quant/quant.module";
import { BacktestStrategiesController } from "./backtest-strategies.controller";

@Module({
  imports: [QuantModule],
  controllers: [BacktestStrategiesController],
})
export class BacktestStrategiesModule {}
