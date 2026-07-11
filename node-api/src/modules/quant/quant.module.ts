import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PythonCoreService } from "./python-core.service";
import { QuantController } from "./quant.controller";

@Module({
  imports: [AuthModule],
  controllers: [QuantController],
  providers: [PythonCoreService],
  exports: [PythonCoreService],
})
export class QuantModule {}
