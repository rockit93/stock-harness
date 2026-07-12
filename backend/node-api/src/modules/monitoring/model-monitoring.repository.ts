import { Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type UsageEventInput = {
  userId: number; conversationId: number; projectId: number | null; provider: string; model: string;
  promptTokens: number; completionTokens: number; durationMs: number; success: boolean;
};

@Injectable()
export class ModelMonitoringRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, conversation_id INTEGER NOT NULL,
        project_id INTEGER, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0, success INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_usage_user_created ON model_usage_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_model_usage_created ON model_usage_events(created_at);
    `);
  }

  record(input: UsageEventInput) {
    const prompt = Math.max(0, Math.round(input.promptTokens || 0));
    const completion = Math.max(0, Math.round(input.completionTokens || 0));
    this.db.prepare(`INSERT INTO model_usage_events
      (user_id, conversation_id, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, duration_ms, success, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.userId, input.conversationId, input.projectId, input.provider, input.model, prompt, completion,
        prompt + completion, Math.max(0, Math.round(input.durationMs)), input.success ? 1 : 0, new Date().toISOString());
  }

  dashboard(userId: number, isAdmin: boolean, range: "day" | "week" | "month", scope: "mine" | "all") {
    const effectiveAll = isAdmin && scope === "all";
    const days = range === "day" ? 1 : range === "week" ? 7 : 30;
    const since = new Date(Date.now() - (days - 1) * 86_400_000);
    since.setHours(0, 0, 0, 0);
    const usage = this.db.prepare(`SELECT e.*, u.username, p.name AS project_name
      FROM model_usage_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN pi_projects p ON p.id=e.project_id
      WHERE e.created_at >= ? ${effectiveAll ? "" : "AND e.user_id = ?"} ORDER BY e.created_at`)
      .all(...(effectiveAll ? [since.toISOString()] : [since.toISOString(), userId])) as any[];
    const conversations = this.db.prepare(`SELECT c.id, c.user_id, c.project_id, c.created_at, u.username, p.name AS project_name
      FROM pi_conversations c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN pi_projects p ON p.id=c.project_id
      WHERE c.created_at >= ? ${effectiveAll ? "" : "AND c.user_id = ?"}`)
      .all(...(effectiveAll ? [since.toISOString()] : [since.toISOString(), userId])) as any[];
    const turns = this.db.prepare(`SELECT m.created_at, c.user_id FROM pi_messages m JOIN pi_conversations c ON c.id=m.conversation_id
      WHERE m.role='user' AND m.created_at >= ? ${effectiveAll ? "" : "AND c.user_id = ?"}`)
      .all(...(effectiveAll ? [since.toISOString()] : [since.toISOString(), userId])) as any[];

    const dateKey = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
    const dates = Array.from({ length: days }, (_, index) => {
      const date = new Date(since.getTime() + index * 86_400_000);
      return dateKey(date.toISOString());
    });
    const trend = new Map(dates.map((date) => [date, { date, promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0, conversations: 0 }]));
    const byModel = new Map<string, any>();
    const byProject = new Map<string, any>();
    const byUser = new Map<string, any>();
    for (const event of usage) {
      const point = trend.get(dateKey(event.created_at));
      if (point) { point.promptTokens += event.prompt_tokens; point.completionTokens += event.completion_tokens; point.totalTokens += event.total_tokens; point.calls += 1; }
      const model = byModel.get(event.model) || { name: event.model, tokens: 0, calls: 0 };
      model.tokens += event.total_tokens; model.calls += 1; byModel.set(event.model, model);
      const username = event.username || `用户 ${event.user_id}`;
      const user = byUser.get(username) || { name: username, tokens: 0, calls: 0 };
      user.tokens += event.total_tokens; user.calls += 1; byUser.set(username, user);
    }
    for (const conversation of conversations) {
      const point = trend.get(dateKey(conversation.created_at)); if (point) point.conversations += 1;
      const key = conversation.project_id ? String(conversation.project_id) : "personal";
      const project = byProject.get(key) || { name: conversation.project_name || "个人对话", conversations: 0, tokens: 0 };
      project.conversations += 1; byProject.set(key, project);
    }
    for (const event of usage) {
      const key = event.project_id ? String(event.project_id) : "personal";
      const project = byProject.get(key) || { name: event.project_name || "个人对话", conversations: 0, tokens: 0 };
      project.tokens += event.total_tokens; byProject.set(key, project);
    }
    const totalPrompt = usage.reduce((sum, item) => sum + item.prompt_tokens, 0);
    const totalCompletion = usage.reduce((sum, item) => sum + item.completion_tokens, 0);
    return {
      scope: effectiveAll ? "all" : "mine", range,
      summary: { totalTokens: totalPrompt + totalCompletion, promptTokens: totalPrompt, completionTokens: totalCompletion,
        calls: usage.length, conversations: conversations.length, turns: turns.length,
        successRate: usage.length ? Math.round(usage.filter((item) => item.success).length / usage.length * 1000) / 10 : 100,
        averageLatencyMs: usage.length ? Math.round(usage.reduce((sum, item) => sum + item.duration_ms, 0) / usage.length) : 0 },
      trend: [...trend.values()],
      models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 8),
      projects: [...byProject.values()].sort((a, b) => b.conversations - a.conversations).slice(0, 10),
      users: effectiveAll ? [...byUser.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 10) : [],
    };
  }
}
