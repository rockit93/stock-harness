import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { HoldingsController } from "./holdings.controller";
import { HoldingsRepository } from "./holdings.repository";
@Module({ imports: [AuthModule, SettingsModule], controllers: [HoldingsController], providers: [HoldingsRepository] })
export class HoldingsModule {}
