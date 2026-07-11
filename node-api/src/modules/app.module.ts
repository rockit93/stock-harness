import { Module } from "@nestjs/common";
import { AuthModule } from "../modules/auth/auth.module";
import { HealthController } from "../modules/health.controller";
import { QuantModule } from "../modules/quant/quant.module";
import { RolesModule } from "../modules/roles/roles.module";
import { SubscriptionsModule } from "../modules/subscriptions/subscriptions.module";

@Module({
  imports: [AuthModule, QuantModule, SubscriptionsModule, RolesModule],
  controllers: [HealthController],
})
export class AppModule {}
