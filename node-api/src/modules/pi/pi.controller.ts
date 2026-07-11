import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { PiRepository } from "./pi.repository";

@UseGuards(AuthGuard)
@Controller("pi")
export class PiController {
  constructor(@Inject(PiRepository) private readonly pi: PiRepository) {}

  @Get("skills")
  listSkills(@Req() req: AuthenticatedRequest) {
    return this.pi.listSkills(Number(req.user.sub));
  }

  @Post("skills")
  createSkill(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pi.createSkill(Number(req.user.sub), body as { name?: string; description?: string; content?: string });
  }

  @Delete("skills/:id")
  removeSkill(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.pi.removeSkill(Number(req.user.sub), Number(id));
    return { ok: true };
  }

  @Get("plugins")
  listPlugins(@Req() req: AuthenticatedRequest) {
    return this.pi.listPlugins(Number(req.user.sub));
  }

  @Post("plugins")
  createPlugin(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pi.createPlugin(Number(req.user.sub), body as { name?: string; description?: string; sourceUrl?: string; code?: string });
  }

  @Put("plugins/:id")
  updatePlugin(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.pi.updatePlugin(Number(req.user.sub), Number(id), body as { name?: string; description?: string; sourceUrl?: string; code?: string });
  }

  @Post("plugins/:id/publish")
  publishPlugin(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.pi.setPluginStatus(Number(req.user.sub), Number(id), "published");
  }

  @Post("plugins/:id/offline")
  offlinePlugin(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.pi.setPluginStatus(Number(req.user.sub), Number(id), "offline");
  }

  @Delete("plugins/:id")
  removePlugin(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.pi.removePlugin(Number(req.user.sub), Number(id));
    return { ok: true };
  }
}
