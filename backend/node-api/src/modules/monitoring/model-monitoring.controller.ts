import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { ModelMonitoringRepository } from "./model-monitoring.repository";

@UseGuards(AuthGuard)
@Controller("monitoring/models")
export class ModelMonitoringController {
  constructor(@Inject(ModelMonitoringRepository) private readonly monitoring: ModelMonitoringRepository) {}

  @Get()
  dashboard(@Req() req: AuthenticatedRequest, @Query("range") rangeInput?: string, @Query("scope") scopeInput?: string) {
    const range = rangeInput === "day" || rangeInput === "week" ? rangeInput : "month";
    const scope = scopeInput === "all" ? "all" : "mine";
    return this.monitoring.dashboard(Number(req.user.sub), req.user.role === "admin", range, scope);
  }
}
