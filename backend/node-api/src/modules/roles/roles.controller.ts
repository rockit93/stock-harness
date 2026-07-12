import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { RolesRepository } from "./roles.repository";

type RoleBody = {
  name?: string;
  responsibility?: string;
  systemPrompt?: string;
  avatar?: string | null;
  modelConfigId?: number | null;
};

@UseGuards(AuthGuard)
@Controller("agent-roles")
export class RolesController {
  constructor(@Inject(RolesRepository) private readonly roles: RolesRepository) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.roles.list(Number(req.user.sub));
  }

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() body: RoleBody) {
    return this.roles.create(Number(req.user.sub), body);
  }

  @Put(":id")
  update(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RoleBody) {
    return this.roles.update(Number(req.user.sub), Number(id), body);
  }

  @Put(":id/capabilities")
  updateCapabilities(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { skillIds?: number[]; pluginIds?: number[]; modelConfigId?: number | null }) {
    return this.roles.updateCapabilities(Number(req.user.sub), Number(id), body);
  }

  @Delete(":id")
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.roles.remove(Number(req.user.sub), Number(id));
    return { ok: true };
  }
}
