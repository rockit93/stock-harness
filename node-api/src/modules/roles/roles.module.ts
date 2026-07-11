import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RolesController } from "./roles.controller";
import { RolesRepository } from "./roles.repository";

@Module({
  imports: [AuthModule],
  controllers: [RolesController],
  providers: [RolesRepository],
})
export class RolesModule {}
