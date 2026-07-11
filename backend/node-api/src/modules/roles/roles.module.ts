import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PiModule } from "../pi/pi.module";
import { RolesController } from "./roles.controller";
import { RolesRepository } from "./roles.repository";

@Module({
  imports: [AuthModule, PiModule],
  controllers: [RolesController],
  providers: [RolesRepository],
})
export class RolesModule {}
