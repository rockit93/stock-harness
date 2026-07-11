import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsRepository } from "./subscriptions.repository";

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsRepository],
})
export class SubscriptionsModule {}
