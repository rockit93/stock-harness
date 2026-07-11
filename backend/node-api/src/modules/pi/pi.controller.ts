import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { PiRepository } from "./pi.repository";
import { PiRuntimeService, PiStreamEvent } from "./pi-runtime.service";

@UseGuards(AuthGuard)
@Controller("pi")
export class PiController {
  constructor(
    @Inject(PiRepository) private readonly pi: PiRepository,
    @Inject(PiRuntimeService) private readonly runtime: PiRuntimeService,
  ) {}

  @Post("chat")
  async chat(
    @Req() req: AuthenticatedRequest,
    @Body() body: { roleId?: number; message?: string },
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
