import { BadGatewayException, Body, Controller, Delete, ForbiddenException, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { SettingsRepository, DataSourceSettings, DisplaySettings, HttpDataSource, ImConnectorSettings, ModelSettings } from "./settings.repository";
import { createHmac } from "node:crypto";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";

@UseGuards(AuthGuard)
@Controller("settings")
export class SettingsController {
  private readonly larkAuthProcesses = new Map<number, ChildProcessWithoutNullStreams>();
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

  @Post("data-source/test-tushare")
  async testTushare(@Req() req: AuthenticatedRequest, @Body() body: Partial<DataSourceSettings>) {
    const userId = Number(req.user.sub);
    const submitted = String(body.tushareToken ?? "").trim();
    const token = submitted || this.settings.getTushareToken(userId);
    if (!token) throw new BadGatewayException("请先填写 Tushare Token");
    const baseUrl = process.env.PYTHON_CORE_URL ?? "http://127.0.0.1:8765";
    try {
      const response = await fetch(`${baseUrl}/tushare/test-connection`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tushare_token: token }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new BadGatewayException(payload.detail ?? "Tushare 连接测试失败");
      return { ok: true, message: "Tushare Token 验证成功，Python Core 已连接。", detail: payload };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(error instanceof Error ? error.message : String(error));
    }
  }

  @Get("display")
  getDisplay(@Req() req: AuthenticatedRequest) {
    return this.settings.getDisplay(Number(req.user.sub));
  }

  @Put("display")
  saveDisplay(@Req() req: AuthenticatedRequest, @Body() body: Partial<DisplaySettings>) {
    return this.settings.saveDisplay(Number(req.user.sub), body);
  }

  @Get("im-connectors/feishu")
  getFeishuConnector(@Req() req: AuthenticatedRequest) { return this.settings.getImConnector(Number(req.user.sub)); }

  @Put("im-connectors/feishu")
  async saveFeishuConnector(@Req() req: AuthenticatedRequest, @Body() body: Partial<ImConnectorSettings>) {
    const userId = Number(req.user.sub);
    const saved = this.settings.saveImConnector(userId, body);
    if (saved.appId && saved.hasAppSecret) await this.runLarkCli(["config", "init", "--name", `alphadock-${userId}`, "--app-id", saved.appId, "--app-secret-stdin", "--brand", saved.brand], this.settings.getImConnectorSecret(userId));
    return saved;
  }

  @Get("im-connectors/feishu/status")
  async getFeishuStatus(@Req() req: AuthenticatedRequest) {
    const userId = Number(req.user.sub);
    const config = this.settings.getImConnector(userId);
    if (!config.enabled) return { ok: false, configured: config.hasAppSecret, message: "连接器未启用" };
    const result = await this.runLarkCli(["auth", "status", "--profile", `alphadock-${userId}`]);
    let detail: any = {}; try { detail = JSON.parse(result.stdout || "{}"); } catch { detail = {}; }
    return { ok: result.exitCode === 0 && detail.ok !== false, configured: true, authenticated: detail.ok === true, profile: `alphadock-${userId}`, message: detail.ok === true ? "飞书 CLI 已认证" : (detail.error?.message || result.stderr || "等待飞书授权"), detail };
  }

  @Post("im-connectors/feishu/authorize")
  async authorizeFeishu(@Req() req: AuthenticatedRequest) {
    const userId = Number(req.user.sub);
    const config = this.settings.getImConnector(userId);
    if (!config.enabled || !config.hasAppSecret) throw new BadGatewayException("请先填写应用凭据、启用连接器并保存");
    this.larkAuthProcesses.get(userId)?.kill();
    const child = this.spawnLarkCli(["auth", "login", "--recommend", "--profile", `alphadock-${userId}`]);
    this.larkAuthProcesses.set(userId, child);
    child.once("close", () => { if (this.larkAuthProcesses.get(userId) === child) this.larkAuthProcesses.delete(userId); });
    return await new Promise<{ ok: boolean; authorizationUrl: string; message: string }>((resolve, reject) => {
      let output = "", settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        const match = output.match(/https?:\/\/[^\s"'<>]+/);
        if (match) { settled = true; clearTimeout(timer); resolve({ ok: true, authorizationUrl: match[0], message: "请在新窗口完成飞书授权" }); }
        else if (error) { settled = true; clearTimeout(timer); reject(error); }
      };
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); finish(); });
      child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); finish(); });
      child.once("error", (error) => finish(error));
      child.once("close", (code) => finish(new Error(output.trim() || `lark-cli exited with ${code}`)));
      const timer = setTimeout(() => finish(new Error("获取飞书授权链接超时，请稍后重试")), 15_000);
    });
  }

  private runLarkCli(args: string[], stdin = ""): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = this.spawnLarkCli(args);
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.on("error", reject);
      child.on("close", (exitCode) => resolve({ exitCode, stdout: stdout.slice(0, 100000), stderr: stderr.slice(0, 100000) }));
      if (stdin) child.stdin.end(stdin); else child.stdin.end();
    });
  }

  private spawnLarkCli(args: string[]) {
    if (process.platform !== "win32") return spawn("lark-cli", args, { shell: false, windowsHide: true });
    const script = path.join(process.env.APPDATA || "", "npm", "node_modules", "@larksuite", "cli", "scripts", "run.js");
    return spawn(process.execPath, [script, ...args], { shell: false, windowsHide: true });
  }

  @Get("http-data-sources")
  listHttpDataSources(@Req() req: AuthenticatedRequest) { return this.settings.listHttpDataSources(Number(req.user.sub)); }

  @Post("http-data-sources")
  createHttpDataSource(@Req() req: AuthenticatedRequest, @Body() body: HttpDataSource) { return this.settings.saveHttpDataSource(Number(req.user.sub), body); }

  @Put("http-data-sources/:id")
  updateHttpDataSource(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: HttpDataSource) { return this.settings.saveHttpDataSource(Number(req.user.sub), { ...body, id: Number(id) }); }

  @Delete("http-data-sources/:id")
  deleteHttpDataSource(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.settings.deleteHttpDataSource(Number(req.user.sub), Number(id)); }

  @Post("http-data-sources/test")
  async testHttpDataSource(@Body() body: HttpDataSource) {
    const headers: Record<string, string> = { ...(body.headers ?? {}) };
    const config = body.authConfig ?? {};
    const secret = config.secretRef ? process.env[config.secretRef] ?? "" : "";
    if (body.authType === "api_key" && secret) headers[config.headerName || "x-api-key"] = secret;
    if (body.authType === "bearer" && secret) headers.authorization = `Bearer ${secret}`;
    if (body.authType === "hmac" && secret) {
      const timestamp = String(Date.now());
      headers[config.timestampHeader || "x-timestamp"] = timestamp;
      headers[config.signatureHeader || "x-signature"] = createHmac(config.algorithm || "sha256", secret).update(timestamp).digest("hex");
    }
    const response = await fetch(String(body.baseUrl), { method: body.method === "POST" ? "POST" : "GET", headers, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    if (!response.ok) throw new BadGatewayException(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    return { ok: true, message: `连接成功，HTTP ${response.status}`, sample: text.slice(0, 2000) };
  }

  @Get("model")
  getModel(@Req() req: AuthenticatedRequest) {
    return this.settings.getModel(Number(req.user.sub));
  }

  @Get("models")
  listModels(@Req() req: AuthenticatedRequest) { return this.settings.listModels(Number(req.user.sub)); }

  @Get("system-private-models")
  async listSystemPrivateModels(@Req() req: AuthenticatedRequest) {
    const baseUrl = this.settings.getSystemOllamaBaseUrl();
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`);
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new BadGatewayException(payload.error ?? "无法读取 Ollama 模型列表");
    const states = new Map(this.settings.privateModelStates().map((item) => [item.model, item]));
    return {
      isAdmin: req.user.role === "admin",
      baseUrl,
      models: (Array.isArray(payload.models) ? payload.models : []).map((item: any) => ({
        model: String(item.name || ""), size: Number(item.size || 0), modifiedAt: item.modified_at || null,
        enabled: states.get(String(item.name || "")) ? Boolean(states.get(String(item.name || ""))!.enabled) : true,
        baseUrl: states.get(String(item.name || ""))?.base_url || baseUrl,
      })).filter((item: any) => item.model),
    };
  }

  @Put("system-private-models/config")
  setSystemPrivateModelConfig(@Req() req: AuthenticatedRequest, @Body() body: { baseUrl?: string }) {
    if (req.user.role !== "admin") throw new ForbiddenException("仅管理员可以修改系统私有模型服务地址");
    return this.settings.setSystemOllamaBaseUrl(String(body.baseUrl || ""), Number(req.user.sub));
  }

  @Put("system-private-models/:model/enabled")
  setSystemPrivateModelEnabled(@Req() req: AuthenticatedRequest, @Param("model") model: string, @Body() body: { enabled?: boolean }) {
    if (req.user.role !== "admin") throw new ForbiddenException("仅管理员可以启用或禁用系统私有模型");
    return this.settings.setPrivateModelEnabled(model, body.enabled !== false, Number(req.user.sub));
  }

  @Put("system-private-models/:model/config")
  setSystemPrivateModelEndpoint(@Req() req: AuthenticatedRequest, @Param("model") model: string, @Body() body: { baseUrl?: string }) {
    if (req.user.role !== "admin") throw new ForbiddenException("仅管理员可以修改私有模型服务地址");
    return this.settings.setPrivateModelBaseUrl(model, String(body.baseUrl || ""), Number(req.user.sub));
  }

  @Post("models")
  saveModelEntry(@Req() req: AuthenticatedRequest, @Body() body: Partial<ModelSettings>) { return this.settings.saveModelEntry(Number(req.user.sub), body); }

  @Post("models/test-connection")
  async testModelEntry(@Req() req: AuthenticatedRequest, @Body() body: Partial<ModelSettings>) {
    const userId = Number(req.user.sub);
    const entry = this.settings.saveModelEntry(userId, body);
    return entry.provider === "ollama" ? this.testOllama(entry) : this.testOpenAi(entry, this.settings.getModelApiKey(userId, entry.id));
  }

  @Put("models/:id")
  updateModelEntry(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: Partial<ModelSettings>) { return this.settings.saveModelEntry(Number(req.user.sub), { ...body, id: Number(id) }); }

  @Delete("models/:id")
  deleteModelEntry(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.settings.deleteModel(Number(req.user.sub), Number(id)); }

  @Get("model/available")
  async getAvailableModels(@Req() req: AuthenticatedRequest, @Query("modelConfigId") modelConfigId?: string) {
    const settings = this.settings.getModelById(Number(req.user.sub), Number(modelConfigId || 0));
    if (settings.provider !== "ollama") {
      return { provider: settings.provider, models: [settings.model].filter(Boolean) };
    }
      return { provider: settings.provider, models: (await this.listOllamaModels(settings)).filter((model: string) => this.settings.isPrivateModelEnabled(model)) };
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

  private async testOpenAi(settings: ModelSettings, apiKey: string) {
    if (!apiKey) throw new BadGatewayException("请先填写 API Key");
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
