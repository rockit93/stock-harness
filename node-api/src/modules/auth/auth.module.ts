import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SqliteUserRepository } from "./sqlite-user.repository";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SqliteUserRepository],
  exports: [AuthService],
})
export class AuthModule {}
