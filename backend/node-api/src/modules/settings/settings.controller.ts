import { BadGatewayException, Body, Controller, Get, Inject, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository, DataSourceSettings, ModelSettings } from "./settings.repository";

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

  @Get("model")
  getModel(@Req() req: AuthenticatedRequest) {
    return this.settings.getModel(Number(req.user.sub));
  }

  @Put("model")
  saveModel(@Req() req: AuthenticatedRequest, @Body() body: Partial<ModelSettings>) {
    return this.settings.saveModel(Number(req.user.sub), body);
  }

  @Post("model/test-connection")
  async testModel(@Req() req: AuthenticatedRequest, @Body() body: Partial<ModelSettings>) {
    const settings = this.settings.saveModel(Number(req.user.sub), body);
    if (settings.provider === "ollama") {
      return this.testOllama(settings);
    }
    return {
      ok: true,
      message: "OpenAI 配置已保存。实际调用时会通过 apiKeyRef 读取环境变量。",
      detail: { provider: settings.provider, model: settings.model, apiKeyRef: settings.apiKeyRef },
    };
  }

  private async testOllama(settings: ModelSettings) {
    try {
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/api/tags`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new BadGatewayException(payload.error ?? payload.message ?? "Ollama 连接测试失败");
      }
      const models = Array.isArray(payload.models) ? payload.models : [];
      const found = models.some((item: { name?: string }) => item.name === settings.model);
      return {
        ok: found,
        message: found ? `Ollama 已连接，模型 ${settings.model} 可用。` : `Ollama 已连接，但还没有下载模型 ${settings.model}。`,
        detail: {
          baseUrl: settings.baseUrl,
          model: settings.model,
          installedModels: models.map((item: { name?: string }) => item.name).filter(Boolean),
          pullCommand: `ollama pull ${settings.model}`,
        },
      };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }
}
