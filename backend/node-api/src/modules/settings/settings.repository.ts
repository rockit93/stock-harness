import { BadRequestException, Injectable } from "@nestjs/common";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type DataSourceSettings = {
  dataSource: "auto" | "futu";
  providerChains: Record<"A Share" | "Hong Kong" | "US", string[]>;
  futuHost: string;
  futuPort: number;
  tushareToken?: string;
  hasTushareToken: boolean;
  updatedAt: string | null;
};

export type DisplaySettings = {
  marketColors: Record<"A Share" | "Hong Kong" | "US", "red-up" | "green-up">;
  updatedAt: string | null;
};

export type ModelSettings = {
  id: number;
  name: string;
  provider: "ollama" | "openai" | "glm" | "minimax";
  model: string;
  baseUrl: string;
  apiKeyRef: string | null;
  apiKey?: string;
  hasApiKey?: boolean;
  temperature: number;
  maxOutputTokens: number;
  contextBudgetTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  updatedAt: string | null;
  isDefault?: boolean;
};

export type HttpDataSource = {
  id?: number; name?: string; key?: string; baseUrl?: string; method?: string;
  authType?: "none" | "api_key" | "bearer" | "hmac";
  authConfig?: Record<string, string>; headers?: Record<string, string>;
  markets?: string[]; capabilities?: string[]; adapterScript?: string; enabled?: boolean;
};

type SettingsRow = {
  user_id: number;
  data_source: string;
  futu_host: string;
  futu_port: number;
  updated_at: string;
  provider_chains?: string;
  display_preferences?: string;
  tushare_token_ciphertext?: string;
};

type ModelSettingsRow = {
  user_id: number;
  provider: string;
  model: string;
  base_url: string;
  api_key_ref: string | null;
  temperature: number;
  max_output_tokens: number;
  context_budget_tokens: number;
  reasoning_effort: string;
  updated_at: string;
};

@Injectable()
export class SettingsRepository {
  private readonly db: DatabaseSync;
  private readonly credentialKey: Buffer;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.credentialKey = this.loadCredentialKey(dataDir);
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        data_source TEXT NOT NULL,
        futu_host TEXT NOT NULL,
        futu_port INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_model_settings (
        user_id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_ref TEXT,
        temperature REAL NOT NULL,
        max_output_tokens INTEGER NOT NULL,
        context_budget_tokens INTEGER NOT NULL,
        reasoning_effort TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_ref TEXT,
        api_key_ciphertext TEXT,
        temperature REAL NOT NULL,
        max_output_tokens INTEGER NOT NULL,
        context_budget_tokens INTEGER NOT NULL,
        reasoning_effort TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
      CREATE TABLE IF NOT EXISTS user_model_seed_versions (
        user_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (user_id, version)
      );
      CREATE TABLE IF NOT EXISTS system_private_models (
        model TEXT PRIMARY KEY,
        base_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_by INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS system_model_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        ollama_base_url TEXT NOT NULL,
        updated_by INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_http_data_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
        source_key TEXT NOT NULL, base_url TEXT NOT NULL, method TEXT NOT NULL,
        auth_type TEXT NOT NULL, auth_config_json TEXT NOT NULL, headers_json TEXT NOT NULL,
        markets_json TEXT NOT NULL, capabilities_json TEXT NOT NULL, adapter_script TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, UNIQUE(user_id, source_key)
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(user_settings)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "provider_chains")) {
      this.db.exec("ALTER TABLE user_settings ADD COLUMN provider_chains TEXT");
    }
    if (!columns.some((column) => column.name === "display_preferences")) {
      this.db.exec("ALTER TABLE user_settings ADD COLUMN display_preferences TEXT");
    }
    if (!columns.some((column) => column.name === "tushare_token_ciphertext")) {
      this.db.exec("ALTER TABLE user_settings ADD COLUMN tushare_token_ciphertext TEXT");
    }
    for (const table of ["user_model_settings", "user_models"]) {
      const modelColumns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!modelColumns.some((column) => column.name === "api_key_ciphertext")) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN api_key_ciphertext TEXT`);
      }
    }
    const privateModelColumns = this.db.prepare("PRAGMA table_info(system_private_models)").all() as Array<{ name: string }>;
    if (!privateModelColumns.some((column) => column.name === "base_url")) {
      this.db.exec("ALTER TABLE system_private_models ADD COLUMN base_url TEXT");
    }
  }

  private loadCredentialKey(dataDir: string): Buffer {
    const keyPath = path.join(dataDir, ".credential-key");
    if (!existsSync(keyPath)) {
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
      try { chmodSync(keyPath, 0o600); } catch { /* Windows permissions are managed by the user profile. */ }
    }
    const key = readFileSync(keyPath);
    if (key.length !== 32) throw new Error("模型密钥加密主密钥无效");
    return key;
  }

  private encryptApiKey(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.credentialKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  private decryptApiKey(value: string): string {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("模型密钥密文格式无效");
    const decipher = createDecipheriv("aes-256-gcm", this.credentialKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  }

  getDisplay(userId: number): DisplaySettings {
    const row = this.db.prepare("SELECT display_preferences, updated_at FROM user_settings WHERE user_id = ?").get(userId) as SettingsRow | undefined;
    return { marketColors: this.normalizeMarketColors(row?.display_preferences), updatedAt: row?.updated_at ?? null };
  }

  saveDisplay(userId: number, body: Partial<DisplaySettings>): DisplaySettings {
    const current = this.getDisplay(userId);
    const marketColors = this.normalizeMarketColors(body.marketColors ?? current.marketColors);
    const dataSource = this.get(userId);
    const updatedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO user_settings (user_id, data_source, futu_host, futu_port, provider_chains, display_preferences, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET display_preferences = excluded.display_preferences, updated_at = excluded.updated_at`)
      .run(userId, dataSource.dataSource, dataSource.futuHost, dataSource.futuPort, JSON.stringify(dataSource.providerChains), JSON.stringify(marketColors), updatedAt);
    return { marketColors, updatedAt };
  }

  private normalizeMarketColors(value: unknown): DisplaySettings["marketColors"] {
    let input: Record<string, unknown> = {};
    try { input = typeof value === "string" ? JSON.parse(value) : (value ?? {}) as Record<string, unknown>; } catch { input = {}; }
    const defaults: DisplaySettings["marketColors"] = { "A Share": "red-up", "Hong Kong": "red-up", US: "green-up" };
    for (const market of Object.keys(defaults) as Array<keyof typeof defaults>) {
      if (["red-up", "green-up"].includes(String(input[market]))) defaults[market] = input[market] as "red-up" | "green-up";
    }
    return defaults;
  }

  get(userId: number): DataSourceSettings {
    const row = this.db
      .prepare("SELECT user_id, data_source, futu_host, futu_port, provider_chains, tushare_token_ciphertext, updated_at FROM user_settings WHERE user_id = ?")
      .get(userId) as SettingsRow | undefined;
    if (!row) {
      return this.defaultSettings();
    }
    return {
      dataSource: "auto",
      futuHost: row.futu_host || "127.0.0.1",
      futuPort: Number(row.futu_port || 11111),
      providerChains: this.normalizeProviderChains(row.provider_chains),
      hasTushareToken: Boolean(row.tushare_token_ciphertext),
      updatedAt: row.updated_at,
    };
  }

  save(userId: number, body: Partial<DataSourceSettings>): DataSourceSettings {
    const current = this.get(userId);
    const dataSource = "auto" as const;
    const futuHost = String(body.futuHost ?? current.futuHost).trim() || "127.0.0.1";
    const futuPort = Number(body.futuPort ?? current.futuPort);
    const providerChains = this.normalizeProviderChains(body.providerChains ?? current.providerChains);
    const existing = this.db.prepare("SELECT tushare_token_ciphertext FROM user_settings WHERE user_id = ?").get(userId) as { tushare_token_ciphertext?: string } | undefined;
    const submittedToken = String(body.tushareToken ?? "").trim();
    const tushareTokenCiphertext = submittedToken ? this.encryptApiKey(submittedToken) : existing?.tushare_token_ciphertext ?? null;

    if (!["auto", "futu"].includes(dataSource)) {
      throw new BadRequestException("数据源必须是 auto 或 futu");
    }
    if (!Number.isInteger(futuPort) || futuPort <= 0 || futuPort > 65535) {
      throw new BadRequestException("Futu OpenD 端口必须是 1-65535 的整数");
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, data_source, futu_host, futu_port, provider_chains, tushare_token_ciphertext, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           data_source = excluded.data_source,
           futu_host = excluded.futu_host,
           futu_port = excluded.futu_port,
           provider_chains = excluded.provider_chains,
           tushare_token_ciphertext = excluded.tushare_token_ciphertext,
           updated_at = excluded.updated_at`,
      )
      .run(userId, dataSource, futuHost, futuPort, JSON.stringify(providerChains), tushareTokenCiphertext, updatedAt);

    return { dataSource, providerChains, futuHost, futuPort, hasTushareToken: Boolean(tushareTokenCiphertext), updatedAt };
  }

  getTushareToken(userId: number): string {
    const row = this.db.prepare("SELECT tushare_token_ciphertext FROM user_settings WHERE user_id = ?").get(userId) as { tushare_token_ciphertext?: string } | undefined;
    return row?.tushare_token_ciphertext ? this.decryptApiKey(row.tushare_token_ciphertext) : "";
  }

  getModel(userId: number): ModelSettings {
    const configured = this.listModels(userId);
    if (configured.length) return configured.find((item) => item.isDefault) ?? configured[0];
    const row = this.db
      .prepare(
        `SELECT user_id, provider, model, base_url, api_key_ref, temperature, max_output_tokens, context_budget_tokens, reasoning_effort, updated_at
         FROM user_model_settings WHERE user_id = ?`,
      )
      .get(userId) as ModelSettingsRow | undefined;
    if (!row) return this.defaultModelSettings();
    return {
      id: 0,
      name: row.model,
      provider: this.normalizeModelProvider(row.provider),
      model: row.model,
      baseUrl: row.base_url,
      apiKeyRef: row.api_key_ref,
      temperature: Number(row.temperature),
      maxOutputTokens: Number(row.max_output_tokens),
      contextBudgetTokens: Number(row.context_budget_tokens),
      reasoningEffort: this.normalizeReasoningEffort(row.reasoning_effort),
      updatedAt: row.updated_at,
    };
  }

  saveModel(userId: number, body: Partial<ModelSettings>): ModelSettings {
    const current = this.getModel(userId);
    const provider = this.normalizeModelProvider(body.provider);
    const model = String(body.model ?? current.model).trim();
    const baseUrl = String(body.baseUrl ?? current.baseUrl).trim() || this.defaultBaseUrl(provider);
    const apiKeyRef = String(body.apiKeyRef ?? current.apiKeyRef ?? "").trim() || null;
    const temperature = Number(body.temperature ?? current.temperature);
    const maxOutputTokens = Number(body.maxOutputTokens ?? current.maxOutputTokens);
    const contextBudgetTokens = Number(body.contextBudgetTokens ?? current.contextBudgetTokens);
    const reasoningEffort = this.normalizeReasoningEffort(body.reasoningEffort ?? current.reasoningEffort);

    if (!model) throw new BadRequestException("模型名称不能为空");
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new BadRequestException("temperature 必须在 0 到 2 之间");
    }
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 131072) {
      throw new BadRequestException("最大输出 token 必须在 256 到 131072 之间");
    }
    if (!Number.isInteger(contextBudgetTokens) || contextBudgetTokens < 1024 || contextBudgetTokens > 1048576) {
      throw new BadRequestException("上下文预算 token 必须在 1024 到 1048576 之间");
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_model_settings
         (user_id, provider, model, base_url, api_key_ref, temperature, max_output_tokens, context_budget_tokens, reasoning_effort, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           base_url = excluded.base_url,
           api_key_ref = excluded.api_key_ref,
           temperature = excluded.temperature,
           max_output_tokens = excluded.max_output_tokens,
           context_budget_tokens = excluded.context_budget_tokens,
           reasoning_effort = excluded.reasoning_effort,
           updated_at = excluded.updated_at`,
      )
      .run(userId, provider, model, baseUrl, apiKeyRef, temperature, maxOutputTokens, contextBudgetTokens, reasoningEffort, updatedAt);

    return { id: 0, name: model, provider, model, baseUrl, apiKeyRef, temperature, maxOutputTokens, contextBudgetTokens, reasoningEffort, updatedAt, isDefault: true };
  }

  listModels(userId: number): Array<ModelSettings & { isDefault: boolean }> {
    this.ensureModelPresets(userId);
    const rows = this.db.prepare(`SELECT * FROM user_models WHERE user_id = ? ORDER BY is_default DESC, id`).all(userId) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, provider: this.normalizeModelProvider(row.provider), model: row.model, baseUrl: row.provider === "ollama" ? this.getSystemOllamaBaseUrl() : row.base_url, apiKeyRef: row.api_key_ref, hasApiKey: Boolean(row.api_key_ciphertext || (row.api_key_ref && process.env[row.api_key_ref])), temperature: Number(row.temperature), maxOutputTokens: Number(row.max_output_tokens), contextBudgetTokens: Number(row.context_budget_tokens), reasoningEffort: this.normalizeReasoningEffort(row.reasoning_effort), updatedAt: row.updated_at, isDefault: Boolean(row.is_default) }));
  }

  getModelById(userId: number, id?: number): ModelSettings & { isDefault?: boolean } {
    if (!id) return this.getModel(userId);
    const found = this.listModels(userId).find((item) => item.id === id);
    if (!found) throw new BadRequestException("模型配置不存在");
    return found;
  }

  privateModelStates() {
    return this.db.prepare("SELECT model, base_url, enabled, updated_at FROM system_private_models").all() as Array<{ model: string; base_url: string | null; enabled: number; updated_at: string }>;
  }

  setPrivateModelEnabled(modelInput: string, enabled: boolean, updatedBy: number) {
    const model = String(modelInput || "").trim();
    if (!model) throw new BadRequestException("模型名称不能为空");
    const updatedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO system_private_models (model, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(model) DO UPDATE SET enabled=excluded.enabled, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(model, enabled ? 1 : 0, updatedBy, updatedAt);
    return { model, enabled, updatedAt };
  }

  setPrivateModelBaseUrl(modelInput: string, baseUrlInput: string, updatedBy: number) {
    const model = String(modelInput || "").trim();
    const baseUrl = this.normalizeOllamaBaseUrl(baseUrlInput);
    if (!model) throw new BadRequestException("模型名称不能为空");
    const updatedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO system_private_models (model, base_url, enabled, updated_by, updated_at) VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(model) DO UPDATE SET base_url=excluded.base_url, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(model, baseUrl, updatedBy, updatedAt);
    this.db.prepare("UPDATE user_models SET base_url = ? WHERE provider = 'ollama' AND model = ?").run(baseUrl, model);
    return { model, baseUrl, updatedAt };
  }

  isPrivateModelEnabled(model: string) {
    const row = this.db.prepare("SELECT enabled FROM system_private_models WHERE model = ?").get(model) as { enabled: number } | undefined;
    return row ? Boolean(row.enabled) : true;
  }

  getSystemOllamaBaseUrl() {
    const row = this.db.prepare("SELECT ollama_base_url FROM system_model_settings WHERE id = 1").get() as { ollama_base_url: string } | undefined;
    return row?.ollama_base_url || "http://127.0.0.1:11434";
  }

  setSystemOllamaBaseUrl(baseUrlInput: string, updatedBy: number) {
    const baseUrl = this.normalizeOllamaBaseUrl(baseUrlInput);
    const updatedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO system_model_settings (id, ollama_base_url, updated_by, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ollama_base_url=excluded.ollama_base_url, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
      .run(baseUrl, updatedBy, updatedAt);
    return { baseUrl, updatedAt };
  }

  private normalizeOllamaBaseUrl(value: string) {
    const baseUrl = String(value || "").trim().replace(/\/$/, "");
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new BadRequestException("请输入有效的 Ollama HTTP 地址"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new BadRequestException("Ollama 地址仅支持 HTTP 或 HTTPS");
    return baseUrl;
  }

  getModelApiKey(userId: number, id?: number): string {
    if (id) {
      const row = this.db.prepare("SELECT api_key_ciphertext, api_key_ref FROM user_models WHERE user_id = ? AND id = ?").get(userId, id) as { api_key_ciphertext?: string; api_key_ref?: string } | undefined;
      if (!row) throw new BadRequestException("模型配置不存在");
      if (row.api_key_ciphertext) return this.decryptApiKey(row.api_key_ciphertext);
      return row.api_key_ref ? process.env[row.api_key_ref] ?? "" : "";
    }
    const selected = this.getModel(userId);
    return selected.id ? this.getModelApiKey(userId, selected.id) : (selected.apiKeyRef ? process.env[selected.apiKeyRef] ?? "" : "");
  }

  saveModelEntry(userId: number, body: Partial<ModelSettings> & { isDefault?: boolean }) {
    const fallback = this.defaultModelSettings();
    const name = String(body.name ?? body.model ?? "").trim();
    const model = String(body.model ?? "").trim();
    const provider = this.normalizeModelProvider(body.provider);
    if (!name || !model) throw new BadRequestException("配置名称和模型名称不能为空");
    const now = new Date().toISOString();
    if (body.isDefault || !this.listModels(userId).length) this.db.prepare("UPDATE user_models SET is_default = 0 WHERE user_id = ?").run(userId);
    const existing = body.id ? this.db.prepare("SELECT api_key_ciphertext FROM user_models WHERE user_id=? AND id=?").get(userId, body.id) as { api_key_ciphertext?: string } | undefined : undefined;
    const submittedApiKey = String(body.apiKey ?? "").trim();
    const ciphertext = submittedApiKey ? this.encryptApiKey(submittedApiKey) : existing?.api_key_ciphertext ?? null;
    const values = [name, provider, model, String(body.baseUrl || this.defaultBaseUrl(provider)).trim(), String(body.apiKeyRef ?? "").trim() || null, ciphertext, Number(body.temperature ?? fallback.temperature), Number(body.maxOutputTokens ?? fallback.maxOutputTokens), Number(body.contextBudgetTokens ?? fallback.contextBudgetTokens), this.normalizeReasoningEffort(body.reasoningEffort), body.isDefault || !this.listModels(userId).length ? 1 : 0, now];
    if (body.id) this.db.prepare(`UPDATE user_models SET name=?,provider=?,model=?,base_url=?,api_key_ref=?,api_key_ciphertext=?,temperature=?,max_output_tokens=?,context_budget_tokens=?,reasoning_effort=?,is_default=?,updated_at=? WHERE user_id=? AND id=?`).run(...values, userId, body.id);
    else this.db.prepare(`INSERT INTO user_models (name,provider,model,base_url,api_key_ref,api_key_ciphertext,temperature,max_output_tokens,context_budget_tokens,reasoning_effort,is_default,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values, userId);
    const id = body.id || Number((this.db.prepare("SELECT last_insert_rowid() id").get() as any).id);
    return this.getModelById(userId, id);
  }

  deleteModel(userId: number, id: number) {
    const rolesTable = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_roles'").get();
    if (rolesTable) {
      const roleColumns = this.db.prepare("PRAGMA table_info(agent_roles)").all() as Array<{ name: string }>;
      if (roleColumns.some((column) => column.name === "model_config_id")) this.db.prepare("UPDATE agent_roles SET model_config_id = NULL WHERE user_id = ? AND model_config_id = ?").run(userId, id);
    }
    this.db.prepare("DELETE FROM user_models WHERE user_id=? AND id=?").run(userId, id);
    const models = this.listModels(userId);
    if (models.length && !models.some((item) => item.isDefault)) this.db.prepare("UPDATE user_models SET is_default=1 WHERE id=?").run(models[0].id);
    return { ok: true };
  }

  listHttpDataSources(userId: number) {
    const rows = this.db.prepare("SELECT * FROM user_http_data_sources WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, key: row.source_key, baseUrl: row.base_url, method: row.method, authType: row.auth_type, authConfig: JSON.parse(row.auth_config_json), headers: JSON.parse(row.headers_json), markets: JSON.parse(row.markets_json), capabilities: JSON.parse(row.capabilities_json), adapterScript: row.adapter_script, enabled: Boolean(row.enabled), updatedAt: row.updated_at, builtin: false }));
  }

  saveHttpDataSource(userId: number, body: HttpDataSource) {
    const name = String(body.name ?? "").trim();
    const key = String(body.key ?? name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    const baseUrl = String(body.baseUrl ?? "").trim();
    const method = String(body.method ?? "GET").toUpperCase();
    const authType = ["api_key", "bearer", "hmac"].includes(String(body.authType)) ? body.authType! : "none";
    const adapterScript = String(body.adapterScript ?? "").trim();
    if (!name || !key || !/^https?:\/\//i.test(baseUrl)) throw new BadRequestException("名称、标识和有效的 HTTP 地址不能为空");
    if (!["GET", "POST"].includes(method)) throw new BadRequestException("请求方法仅支持 GET 或 POST");
    if (!adapterScript.includes("function adapt") && !adapterScript.includes("const adapt") && !adapterScript.includes("export default")) throw new BadRequestException("适配脚本必须定义 adapt 函数或 export default");
    try { new Function(adapterScript.replace(/export\s+default/, "return")); } catch (error) { throw new BadRequestException(`适配脚本语法错误：${error instanceof Error ? error.message : String(error)}`); }
    const values = [name, key, baseUrl, method, authType, JSON.stringify(body.authConfig ?? {}), JSON.stringify(body.headers ?? {}), JSON.stringify(body.markets ?? []), JSON.stringify(body.capabilities ?? []), adapterScript, body.enabled === false ? 0 : 1, new Date().toISOString()];
    if (body.id) this.db.prepare(`UPDATE user_http_data_sources SET name=?,source_key=?,base_url=?,method=?,auth_type=?,auth_config_json=?,headers_json=?,markets_json=?,capabilities_json=?,adapter_script=?,enabled=?,updated_at=? WHERE user_id=? AND id=?`).run(...values, userId, body.id);
    else this.db.prepare(`INSERT INTO user_http_data_sources (name,source_key,base_url,method,auth_type,auth_config_json,headers_json,markets_json,capabilities_json,adapter_script,enabled,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values, userId);
    return this.listHttpDataSources(userId).find((item) => body.id ? item.id === body.id : item.key === key);
  }

  deleteHttpDataSource(userId: number, id: number) {
    this.db.prepare("DELETE FROM user_http_data_sources WHERE user_id = ? AND id = ?").run(userId, id);
    return { ok: true };
  }

  private defaultSettings(): DataSourceSettings {
    return {
      dataSource: "auto",
      providerChains: this.normalizeProviderChains(null),
      futuHost: "127.0.0.1",
      futuPort: 11111,
      hasTushareToken: false,
      updatedAt: null,
    };
  }

  private normalizeProviderChains(value: unknown): DataSourceSettings["providerChains"] {
    let parsed: unknown = value;
    if (typeof value === "string") {
      try { parsed = JSON.parse(value); } catch { parsed = null; }
    }
    const input = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    const allowed: Record<string, string[]> = {
      "A Share": ["akshare", "tushare", "baostock", "futu", "yfinance"],
      "Hong Kong": ["futu", "akshare", "yfinance"],
      US: ["sec_edgar", "futu", "yfinance", "akshare"],
    };
    const defaults: DataSourceSettings["providerChains"] = {
      "A Share": ["akshare", "baostock", "yfinance"],
      "Hong Kong": ["futu", "akshare", "yfinance"],
      US: ["sec_edgar", "futu", "yfinance"],
    };
    for (const market of Object.keys(defaults) as Array<keyof typeof defaults>) {
      const items = Array.isArray(input[market]) ? input[market] as unknown[] : defaults[market];
      const clean = [...new Set(items.map(String).filter((item) => allowed[market].includes(item) || /^[a-z0-9][a-z0-9_-]{1,63}$/.test(item)))];
      defaults[market] = clean.length ? clean : defaults[market];
    }
    return defaults;
  }

  private defaultModelSettings(): ModelSettings {
    return {
      id: 0,
      name: "本地 Qwen",
      provider: "ollama",
      model: "qwen2.5-coder:14b",
      baseUrl: "http://127.0.0.1:11434",
      apiKeyRef: null,
      temperature: 0.2,
      maxOutputTokens: 4096,
      contextBudgetTokens: 32768,
      reasoningEffort: "medium",
      updatedAt: null,
      isDefault: true,
    };
  }

  private ensureModelPresets(userId: number) {
    const version = 2;
    const seeded = this.db.prepare("SELECT 1 FROM user_model_seed_versions WHERE user_id = ? AND version = ?").get(userId, version);
    if (seeded) return;

    const now = new Date().toISOString();
    const presets = [
      { name: "本地 Qwen 3 8B", model: "qwen3:8b" },
      { name: "本地 Gemma 4", model: "gemma4:latest" },
      { name: "本地 DeepSeek R1 8B", model: "deepseek-r1:8b" },
    ];
    this.db.exec("BEGIN");
    try {
      const insertPreset = this.db.prepare(`
        INSERT OR IGNORE INTO user_models
          (user_id, name, provider, model, base_url, api_key_ref, temperature, max_output_tokens, context_budget_tokens, reasoning_effort, is_default, updated_at)
        SELECT ?, ?, 'ollama', ?, 'http://127.0.0.1:11434', NULL, 0.2, 4096, 32768, 'medium',
          CASE WHEN EXISTS (SELECT 1 FROM user_models WHERE user_id = ?) THEN 0 ELSE 1 END, ?
        WHERE NOT EXISTS (SELECT 1 FROM user_models WHERE user_id = ? AND model = ?)
      `);
      for (const preset of presets) {
        insertPreset.run(userId, preset.name, preset.model, userId, now, userId, preset.model);
      }
      this.db.prepare("INSERT INTO user_model_seed_versions (user_id, version, applied_at) VALUES (?, ?, ?)").run(userId, version, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private defaultBaseUrl(provider: ModelSettings["provider"]) {
    return {
      ollama: "http://127.0.0.1:11434",
      openai: "https://api.openai.com/v1",
      glm: "https://open.bigmodel.cn/api/paas/v4",
      minimax: "https://api.minimaxi.com/v1",
    }[provider];
  }

  private normalizeModelProvider(value: unknown): ModelSettings["provider"] {
    return value === "openai" || value === "glm" || value === "minimax" ? value : "ollama";
  }

  private normalizeReasoningEffort(value: unknown): "low" | "medium" | "high" {
    return value === "low" || value === "high" ? value : "medium";
  }
}
