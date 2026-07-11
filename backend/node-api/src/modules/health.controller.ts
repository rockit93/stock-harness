import { Controller, Get, Inject } from "@nestjs/common";
import { PythonCoreService } from "./quant/python-core.service";

@Controller()
export class HealthController {
  constructor(@Inject(PythonCoreService) private readonly pythonCore: PythonCoreService) {}

  @Get()
  root() {
    return {
      service: "stock-harness-node-api",
      framework: "NestJS + Fastify",
      auth_header: "x-jwt-token",
      routes: ["POST /auth/register", "POST /auth/login", "GET /auth/me", "GET /health", "GET /strategies", "POST /backtest"],
    };
  }

  @Get("health")
  async health() {
    return {
      status: "ok",
      service: "node-api",
      framework: "NestJS + Fastify",
      storage: "sqlite",
      python_core: await this.pythonCore.health(),
    };
  }
}
