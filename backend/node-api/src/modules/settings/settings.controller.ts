import { BadGatewayException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
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

  @Get("models")
  listModels(@Req() req: AuthenticatedRequest) { return this.settings.listModels(Number(req.user.sub)); }

  @Post("models")
  saveModelEntry(@Req() req: AuthenticatedRequest, @Body() body: Partial<ModelSettings>) { return this.settings.saveModelEntry(Number(req.user.sub), body); }

  @Post("models/test-connection")
  async testModelEntry(@Req() req: AuthenticatedRequest, @Body() body: Partial<ModelSettings>) {
    const entry = this.settings.saveModelEntry(Number(req.user.sub), body);
    return entry.provider === "ollama" ? this.testOllama(entry) : this.testOpenAi(entry);
  }

  @Put("models/:id")
  updateModelEntry(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: Partial<ModelSettings>) { return this.settings.saveModelEntry(Number(req.user.sub), { ...body, id: Number(id) }); }

  @Delete("models/:id")
  deleteModelEntry(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.settings.deleteModel(Number(req.user.sub), Number(id)); }

  @Get("model/available")
  async getAvailableModels(@Req() req: AuthenticatedRequest) {
    const settings = this.settings.getModel(Number(req.user.sub));
    if (settings.provider !== "ollama") {
      return { provider: settings.provider, models: [settings.model].filter(Boolean) };
    }
    return { provider: settings.provider, models: await this.listOllamaModels(settings) };
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

  private async testOpenAi(settings: ModelSettings) {
    const apiKey = settings.apiKeyRef ? process.env[settings.apiKeyRef] : "";
    if (!apiKey) throw new BadGatewayException(`未找到 API Key 环境变量：${settings.apiKeyRef || "未配置"}`);
    try {
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok) throw new BadGatewayException(payload.error?.message ?? `HTTP ${response.status}`);
      return { ok: true, message: `OpenAI 兼容接口已连接，模型配置 ${settings.name} 可用。`, detail: { provider: settings.provider, model: settings.model } };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }

  private async listOllamaModels(settings: ModelSettings) {
    try {
      const response = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/api/tags`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new BadGatewayException(payload.error ?? payload.message ?? "Ollama model list failed");
      }
      const models = Array.isArray(payload.models) ? payload.models : [];
      return models.map((item: { name?: string }) => item.name).filter(Boolean);
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }
}
