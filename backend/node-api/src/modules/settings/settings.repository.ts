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
  provider: "ollama" | "openai";
  model: string;
  baseUrl: string;
  apiKeyRef: string | null;
  temperature: number;
  maxOutputTokens: number;
  contextBudgetTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  updatedAt: string | null;
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
    const row = this.db
      .prepare(
        `SELECT user_id, provider, model, base_url, api_key_ref, temperature, max_output_tokens, context_budget_tokens, reasoning_effort, updated_at
         FROM user_model_settings WHERE user_id = ?`,
      )
      .get(userId) as ModelSettingsRow | undefined;
    if (!row) return this.defaultModelSettings();
    return {
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

    return { provider, model, baseUrl, apiKeyRef, temperature, maxOutputTokens, contextBudgetTokens, reasoningEffort, updatedAt };
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
      provider: "ollama",
      model: "qwen2.5-coder:14b",
      baseUrl: "http://127.0.0.1:11434",
      apiKeyRef: null,
      temperature: 0.2,
      maxOutputTokens: 4096,
      contextBudgetTokens: 32768,
      reasoningEffort: "medium",
      updatedAt: null,
    };
  }

  private defaultBaseUrl(provider: "ollama" | "openai") {
    return provider === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com/v1";
  }

  private normalizeReasoningEffort(value: unknown): "low" | "medium" | "high" {
    return value === "low" || value === "high" ? value : "medium";
  }
}
