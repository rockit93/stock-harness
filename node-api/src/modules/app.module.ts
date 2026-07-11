import { Module } from "@nestjs/common";
import { AuthModule } from "../modules/auth/auth.module";
import { HealthController } from "../modules/health.controller";
import { QuantModule } from "../modules/quant/quant.module";

@Module({
  imports: [AuthModule, QuantModule],
  controllers: [HealthController],
})
export class AppModule {}
