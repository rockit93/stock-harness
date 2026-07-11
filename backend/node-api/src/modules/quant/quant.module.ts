import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { PythonCoreService } from "./python-core.service";
import { QuantController } from "./quant.controller";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [QuantController],
  providers: [PythonCoreService],
  exports: [PythonCoreService],
})
export class QuantModule {}
