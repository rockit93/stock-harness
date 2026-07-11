import { BadGatewayException, Body, Controller, Get, Inject, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository, DataSourceSettings } from "./settings.repository";

@UseGuards(AuthGuard)
@Controller("settings")
export class SettingsController {
  constructor(@Inject(SettingsRepository) private readonly settings: SettingsRepository) {}

  @Get("data-source")
  getDataSource(@Req() req: AuthenticatedRequest) {
    return this.settings.get(Number(req.user.sub));
  }

  @Put("data-source")
  saveDataSource(@Req() req: AuthenticatedRequest, @Body() body: Partial<DataSourceSettings>) {
    return this.settings.save(Number(req.user.sub), body);
  }

  @Post("data-source/test-connection")
  async testDataSource(@Req() req: AuthenticatedRequest, @Body() body: Partial<DataSourceSettings>) {
    const current = this.settings.get(Number(req.user.sub));
    const futuHost = String(body.futuHost ?? current.futuHost).trim() || "127.0.0.1";
    const futuPort = Number(body.futuPort ?? current.futuPort);
    const baseUrl = process.env.PYTHON_CORE_URL ?? "http://127.0.0.1:8765";

    try {
      const response = await fetch(`${baseUrl}/futu/test-connection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ futu_host: futuHost, futu_port: futuPort }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new BadGatewayException(payload.detail ?? payload.message ?? "Futu OpenD 连接测试失败");
      }
      return {
        ok: true,
        message: `Node API 已通过 Python Core 连上 Futu OpenD (${futuHost}:${futuPort})`,
        detail: payload,
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }
}
