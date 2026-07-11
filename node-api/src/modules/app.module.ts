import { Module } from "@nestjs/common";
import { AuthModule } from "../modules/auth/auth.module";
import { HealthController } from "../modules/health.controller";
import { PiModule } from "../modules/pi/pi.module";
import { QuantModule } from "../modules/quant/quant.module";
import { RolesModule } from "../modules/roles/roles.module";
import { SettingsModule } from "../modules/settings/settings.module";
import { SubscriptionsModule } from "../modules/subscriptions/subscriptions.module";

@Module({
  imports: [AuthModule, SettingsModule, QuantModule, SubscriptionsModule, RolesModule, PiModule],
  controllers: [HealthController],
})
export class AppModule {}
