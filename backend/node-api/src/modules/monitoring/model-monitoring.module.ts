import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModelMonitoringController } from "./model-monitoring.controller";
import { ModelMonitoringRepository } from "./model-monitoring.repository";

@Module({ imports: [AuthModule], controllers: [ModelMonitoringController], providers: [ModelMonitoringRepository], exports: [ModelMonitoringRepository] })
export class ModelMonitoringModule {}
