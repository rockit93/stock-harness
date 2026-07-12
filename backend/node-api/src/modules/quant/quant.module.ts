import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { PythonCoreService } from "./python-core.service";
import { QuantController } from "./quant.controller";
import { BacktestStrategiesRepository } from "../backtest-strategies/backtest-strategies.repository";
import { SymbolCacheRepository } from "./symbol-cache.repository";
import { HttpDataSourceService } from "./http-data-source.service";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [QuantController],
  providers: [PythonCoreService, BacktestStrategiesRepository, SymbolCacheRepository, HttpDataSourceService],
  exports: [PythonCoreService, BacktestStrategiesRepository, HttpDataSourceService],
})
export class QuantModule {}
