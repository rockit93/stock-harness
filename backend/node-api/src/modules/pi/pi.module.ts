import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PiController } from "./pi.controller";
import { PiRepository } from "./pi.repository";
import { PiWorkspaceService } from "./pi-workspace.service";
import { SettingsModule } from "../settings/settings.module";
import { PiRuntimeRepository } from "./pi-runtime.repository";
import { PiRuntimeService } from "./pi-runtime.service";
import { ToolRegistryService } from "./tools/tool-registry.service";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [PiController],
  providers: [PiRepository, PiWorkspaceService, PiRuntimeRepository, PiRuntimeService, ToolRegistryService],
  exports: [PiRepository, PiWorkspaceService],
})
export class PiModule {}
