import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { QuantModule } from "../quant/quant.module";
import { SettingsModule } from "../settings/settings.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { LabelStrategiesController } from "./label-strategies.controller";
import { LabelStrategiesRepository } from "./label-strategies.repository";
import { LabelStrategiesService } from "./label-strategies.service";

@Module({
  imports: [AuthModule, SettingsModule, QuantModule, SubscriptionsModule],
  controllers: [LabelStrategiesController],
  providers: [LabelStrategiesRepository, LabelStrategiesService],
})
export class LabelStrategiesModule {}
