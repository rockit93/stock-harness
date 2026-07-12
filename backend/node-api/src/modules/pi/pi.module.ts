import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PiController } from "./pi.controller";
import { PiRepository } from "./pi.repository";
import { PiWorkspaceService } from "./pi-workspace.service";
import { SettingsModule } from "../settings/settings.module";
import { PiRuntimeRepository } from "./pi-runtime.repository";
import { PiRuntimeService } from "./pi-runtime.service";
import { ToolRegistryService } from "./tools/tool-registry.service";
import { ModelMonitoringModule } from "../monitoring/model-monitoring.module";
import { LarkImGatewayService } from "./lark-im-gateway.service";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
  imports: [AuthModule, SettingsModule, ModelMonitoringModule, SubscriptionsModule],
  controllers: [PiController],
  providers: [PiRepository, PiWorkspaceService, PiRuntimeRepository, PiRuntimeService, ToolRegistryService, LarkImGatewayService],
  exports: [PiRepository, PiWorkspaceService],
})
export class PiModule {}
