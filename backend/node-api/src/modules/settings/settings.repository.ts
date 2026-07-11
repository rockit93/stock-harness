import { BadRequestException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type DataSourceSettings = {
  dataSource: "auto" | "futu";
  futuHost: string;
  futuPort: number;
  updatedAt: string | null;
};

export type ModelSettings = {
  id: number;
  name: string;
  provider: "ollama" | "openai";
  model: string;
  baseUrl: string;
  apiKeyRef: string | null;
  temperature: number;
  maxOutputTokens: number;
  contextBudgetTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  updatedAt: string | null;
  isDefault?: boolean;
};

type SettingsRow = {
  user_id: number;
  data_source: string;
  futu_host: string;
  futu_port: number;
  updated_at: string;
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

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
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
        temperature REAL NOT NULL,
        max_output_tokens INTEGER NOT NULL,
        context_budget_tokens INTEGER NOT NULL,
        reasoning_effort TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
    `);
  }

  get(userId: number): DataSourceSettings {
    const row = this.db
      .prepare("SELECT user_id, data_source, futu_host, futu_port, updated_at FROM user_settings WHERE user_id = ?")
      .get(userId) as SettingsRow | undefined;
    if (!row) {
      return this.defaultSettings();
    }
    return {
      dataSource: row.data_source === "futu" ? "futu" : "auto",
      futuHost: row.futu_host || "127.0.0.1",
      futuPort: Number(row.futu_port || 11111),
      updatedAt: row.updated_at,
    };
  }

  save(userId: number, body: Partial<DataSourceSettings>): DataSourceSettings {
    const current = this.get(userId);
    const dataSource = body.dataSource ?? current.dataSource;
    const futuHost = String(body.futuHost ?? current.futuHost).trim() || "127.0.0.1";
    const futuPort = Number(body.futuPort ?? current.futuPort);

    if (!["auto", "futu"].includes(dataSource)) {
      throw new BadRequestException("数据源必须是 auto 或 futu");
    }
    if (!Number.isInteger(futuPort) || futuPort <= 0 || futuPort > 65535) {
      throw new BadRequestException("Futu OpenD 端口必须是 1-65535 的整数");
    }

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, data_source, futu_host, futu_port, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           data_source = excluded.data_source,
           futu_host = excluded.futu_host,
           futu_port = excluded.futu_port,
           updated_at = excluded.updated_at`,
      )
      .run(userId, dataSource, futuHost, futuPort, updatedAt);

    return { dataSource, futuHost, futuPort, updatedAt };
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
      provider: row.provider === "openai" ? "openai" : "ollama",
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
    const provider = body.provider === "openai" ? "openai" : "ollama";
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
    const rows = this.db.prepare(`SELECT * FROM user_models WHERE user_id = ? ORDER BY is_default DESC, id`).all(userId) as any[];
    return rows.map((row) => ({ id: row.id, name: row.name, provider: row.provider === "openai" ? "openai" : "ollama", model: row.model, baseUrl: row.base_url, apiKeyRef: row.api_key_ref, temperature: Number(row.temperature), maxOutputTokens: Number(row.max_output_tokens), contextBudgetTokens: Number(row.context_budget_tokens), reasoningEffort: this.normalizeReasoningEffort(row.reasoning_effort), updatedAt: row.updated_at, isDefault: Boolean(row.is_default) }));
  }

  getModelById(userId: number, id?: number): ModelSettings & { isDefault?: boolean } {
    if (!id) return this.getModel(userId);
    const found = this.listModels(userId).find((item) => item.id === id);
    if (!found) throw new BadRequestException("模型配置不存在");
    return found;
  }

  saveModelEntry(userId: number, body: Partial<ModelSettings> & { isDefault?: boolean }) {
    const fallback = this.defaultModelSettings();
    const name = String(body.name ?? body.model ?? "").trim();
    const model = String(body.model ?? "").trim();
    const provider = body.provider === "openai" ? "openai" : "ollama";
    if (!name || !model) throw new BadRequestException("配置名称和模型名称不能为空");
    const now = new Date().toISOString();
    if (body.isDefault || !this.listModels(userId).length) this.db.prepare("UPDATE user_models SET is_default = 0 WHERE user_id = ?").run(userId);
    const values = [name, provider, model, String(body.baseUrl || this.defaultBaseUrl(provider)).trim(), String(body.apiKeyRef ?? "").trim() || null, Number(body.temperature ?? fallback.temperature), Number(body.maxOutputTokens ?? fallback.maxOutputTokens), Number(body.contextBudgetTokens ?? fallback.contextBudgetTokens), this.normalizeReasoningEffort(body.reasoningEffort), body.isDefault || !this.listModels(userId).length ? 1 : 0, now];
    if (body.id) this.db.prepare(`UPDATE user_models SET name=?,provider=?,model=?,base_url=?,api_key_ref=?,temperature=?,max_output_tokens=?,context_budget_tokens=?,reasoning_effort=?,is_default=?,updated_at=? WHERE user_id=? AND id=?`).run(...values, userId, body.id);
    else this.db.prepare(`INSERT INTO user_models (name,provider,model,base_url,api_key_ref,temperature,max_output_tokens,context_budget_tokens,reasoning_effort,is_default,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values, userId);
    const id = body.id || Number((this.db.prepare("SELECT last_insert_rowid() id").get() as any).id);
    return this.getModelById(userId, id);
  }

  deleteModel(userId: number, id: number) {
    this.db.prepare("DELETE FROM user_models WHERE user_id=? AND id=?").run(userId, id);
    const models = this.listModels(userId);
    if (models.length && !models.some((item) => item.isDefault)) this.db.prepare("UPDATE user_models SET is_default=1 WHERE id=?").run(models[0].id);
    return { ok: true };
  }

  private defaultSettings(): DataSourceSettings {
    return {
      dataSource: "auto",
      futuHost: "127.0.0.1",
      futuPort: 11111,
      updatedAt: null,
    };
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

  private defaultBaseUrl(provider: "ollama" | "openai") {
    return provider === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com/v1";
  }

  private normalizeReasoningEffort(value: unknown): "low" | "medium" | "high" {
    return value === "low" || value === "high" ? value : "medium";
  }
}
