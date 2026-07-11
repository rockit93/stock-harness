import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsController } from "./settings.controller";
import { SettingsRepository } from "./settings.repository";

@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsRepository],
  exports: [SettingsRepository],
})
export class SettingsModule {}
