import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { BindingBody, StrategyBody } from "./label-strategies.repository";
import { LabelStrategiesService } from "./label-strategies.service";

@UseGuards(AuthGuard)
@Controller("label-strategies")
export class LabelStrategiesController {
  constructor(@Inject(LabelStrategiesService) private readonly service: LabelStrategiesService) {}

  @Get()
  strategies(@Req() req: AuthenticatedRequest) {
    return this.service.strategies(Number(req.user.sub));
  }

  @Get("templates")
  templates() {
    return this.service.templates();
  }

  @Post()
  createStrategy(@Req() req: AuthenticatedRequest, @Body() body: StrategyBody) {
    return this.service.createStrategy(Number(req.user.sub), body);
  }

  @Post("templates/:key/copy")
  copyTemplate(@Req() req: AuthenticatedRequest, @Param("key") key: string) {
    return this.service.createStrategyFromTemplate(Number(req.user.sub), key);
  }

  @Delete(":id")
  removeStrategy(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.service.removeStrategy(Number(req.user.sub), Number(id));
    return { ok: true };
  }

  @Post(":id/run")
  runStrategy(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.runStrategy(Number(req.user.sub), Number(id));
  }

  @Get("bindings")
  bindings(@Req() req: AuthenticatedRequest) {
    return this.service.bindings(Number(req.user.sub));
  }

  @Get("labels")
  labels(@Req() req: AuthenticatedRequest) {
    return this.service.labels(Number(req.user.sub));
  }

  @Post("bindings")
  createBinding(@Req() req: AuthenticatedRequest, @Body() body: BindingBody) {
    return this.service.createBinding(Number(req.user.sub), body);
  }

  @Delete("bindings/:id")
  removeBinding(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.service.removeBinding(Number(req.user.sub), Number(id));
    return { ok: true };
  }

  @Post("bindings/:id/run")
  runBinding(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.runBinding(Number(req.user.sub), Number(id));
  }
}
