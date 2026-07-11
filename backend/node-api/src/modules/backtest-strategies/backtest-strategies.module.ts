import { Module } from "@nestjs/common";
import { QuantModule } from "../quant/quant.module";
import { AuthModule } from "../auth/auth.module";
import { BacktestStrategiesController } from "./backtest-strategies.controller";

@Module({
  imports: [AuthModule, QuantModule],
  controllers: [BacktestStrategiesController],
})
export class BacktestStrategiesModule {}
