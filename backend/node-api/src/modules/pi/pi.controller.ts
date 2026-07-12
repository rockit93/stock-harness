import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { PiRepository } from "./pi.repository";
import { ChatBody, PiRuntimeService, PiStreamEvent } from "./pi-runtime.service";
import { LarkImGatewayService } from "./lark-im-gateway.service";

@UseGuards(AuthGuard)
@Controller("pi")
export class PiController {
  constructor(
    @Inject(PiRepository) private readonly pi: PiRepository,
    @Inject(PiRuntimeService) private readonly runtime: PiRuntimeService,
    @Inject(LarkImGatewayService) private readonly larkGateway: LarkImGatewayService,
  ) {}

  @Get("im/feishu/status")
  imGatewayStatus(@Req() req: AuthenticatedRequest) { return this.larkGateway.getStatus(Number(req.user.sub)); }

  @Get("im/feishu/logs")
  imGatewayLogs(@Req() req: AuthenticatedRequest) { return { logs: this.larkGateway.getLogs(Number(req.user.sub)) }; }

  @Post("im/feishu/restart")
  restartImGateway(@Req() req: AuthenticatedRequest) { return this.larkGateway.restart(Number(req.user.sub)); }

  @Delete("im/feishu/logs")
  clearImGatewayLogs(@Req() req: AuthenticatedRequest) { return this.larkGateway.clearLogs(Number(req.user.sub)); }

  @Get("conversations")
  listConversations(@Req() req: AuthenticatedRequest) {
    return this.runtime.listConversations(Number(req.user.sub));
  }

  @Get("conversations/:id/status")
  conversationStatus(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.runtime.conversationStatus(Number(req.user.sub), Number(id));
  }

  @Put("conversations/:id")
  renameConversation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { title?: string }) {
    return this.runtime.renameConversation(Number(req.user.sub), Number(id), body.title || "");
  }

  @Post("conversations/:id/archive")
  archiveConversation(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.runtime.setConversationArchived(Number(req.user.sub), Number(id), true);
  }

  @Post("conversations/:id/restore")
  restoreConversation(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.runtime.setConversationArchived(Number(req.user.sub), Number(id), false);
  }

  @Get("projects")
  listProjects(@Req() req: AuthenticatedRequest) {
    return this.runtime.listProjects(Number(req.user.sub));
  }

  @Post("projects")
  createProject(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.runtime.saveProject(Number(req.user.sub), null, body as Parameters<PiRuntimeService["saveProject"]>[2]);
  }

  @Put("projects/:id")
  updateProject(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.runtime.saveProject(Number(req.user.sub), Number(id), body as Parameters<PiRuntimeService["saveProject"]>[2]);
  }

  @Delete("projects/:id")
  removeProject(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    this.runtime.removeProject(Number(req.user.sub), Number(id));
    return { ok: true };
  }

  @Post("projects/:id/archive")
  archiveProject(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.runtime.setProjectArchived(Number(req.user.sub), Number(id), true);
  }

  @Post("projects/:id/restore")
  restoreProject(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.runtime.setProjectArchived(Number(req.user.sub), Number(id), false);
  }

  @Get("tools")
  listTools() { return { tools: this.runtime.listTools() }; }

  @Put("projects/:id/tools")
  setProjectTools(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { toolNames?: string[] }) {
    return this.runtime.setProjectTools(Number(req.user.sub), Number(id), body.toolNames || []);
  }

  @Put("roles/:id/tools")
  setRoleTools(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: { toolNames?: string[] }) {
    return this.runtime.setRoleTools(Number(req.user.sub), Number(id), body.toolNames || []);
  }

  @Post("chat")
  async chat(
    @Req() req: AuthenticatedRequest,
    @Body() body: ChatBody,
    @Res() reply: FastifyReply,
  ) {
    reply.hijack();
    const requestOrigin = req.headers.origin;
    const allowedOrigin = Array.isArray(requestOrigin) ? requestOrigin[0] : requestOrigin;
    reply.raw.statusCode = 200;
    reply.raw.setHeader("access-control-allow-origin", allowedOrigin || "*");
    reply.raw.setHeader("access-control-allow-headers", "content-type, x-jwt-token, authorization");
    reply.raw.setHeader("access-control-expose-headers", "x-jwt-token");
    reply.raw.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-cache, no-transform");
    reply.raw.setHeader("x-accel-buffering", "no");
    const emit = (event: PiStreamEvent) => reply.raw.write(`${JSON.stringify(event)}\n`);
    try {
      await this.runtime.chat(Number(req.user.sub), body, emit);
    } catch (error) {
      emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      reply.raw.end();
    }
  }

  @Get("skills")
  listSkills(@Req() req: AuthenticatedRequest) {
    return this.pi.listSkills(Number(req.user.sub));
  }

  @Post("skills")
  createSkill(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.pi.createSkill(Number(req.user.sub), body as { name?: string; description?: string; content?: string });
  }

  @Get("skills/:id/package")
  getSkillPackage(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.pi.getSkillPackage(Number(req.user.sub), Number(id));
  }

  @Put("skills/:id")
  updateSkill(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.pi.updateSkill(Number(req.user.sub), Number(id), body as { name?: string; description?: string; content?: string; visibility?: string });
  }

  @Post("skills/:id/copy")
  copySkill(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.pi.copySkill(Number(req.user.sub), Number(id));
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
