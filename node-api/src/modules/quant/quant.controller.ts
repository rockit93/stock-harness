import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { PythonCoreService } from "./python-core.service";

@UseGuards(AuthGuard)
@Controller()
export class QuantController {
  constructor(@Inject(PythonCoreService) private readonly pythonCore: PythonCoreService) {}

  @Get("strategies")
  strategies() {
    return this.pythonCore.strategies();
  }

  @Post("backtest")
  backtest(@Body() body: unknown) {
    return this.pythonCore.backtest(body);
  }
}
