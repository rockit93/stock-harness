import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PiController } from "./pi.controller";
import { PiRepository } from "./pi.repository";

@Module({
  imports: [AuthModule],
  controllers: [PiController],
  providers: [PiRepository],
  exports: [PiRepository],
})
export class PiModule {}
