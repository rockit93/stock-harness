import { Module } from "@nestjs/common";
import { AuthModule } from "../modules/auth/auth.module";
import { HealthController } from "../modules/health.controller";
import { LabelStrategiesModule } from "../modules/label-strategies/label-strategies.module";
import { PiModule } from "../modules/pi/pi.module";
import { QuantModule } from "../modules/quant/quant.module";
import { RolesModule } from "../modules/roles/roles.module";
import { SettingsModule } from "../modules/settings/settings.module";
import { SubscriptionsModule } from "../modules/subscriptions/subscriptions.module";
import { BacktestStrategiesModule } from "./backtest-strategies/backtest-strategies.module";
import { ModelMonitoringModule } from "./monitoring/model-monitoring.module";
import { HoldingsModule } from "./holdings/holdings.module";

@Module({
  imports: [AuthModule, SettingsModule, ModelMonitoringModule, QuantModule, BacktestStrategiesModule, HoldingsModule, SubscriptionsModule, LabelStrategiesModule, RolesModule, PiModule],
  controllers: [HealthController],
})
export class AppModule {}
