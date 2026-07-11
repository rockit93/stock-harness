import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type BacktestStrategyBody = {
  name?: string;
  description?: string;
  definition?: unknown;
};

type StrategyRow = {
  id: number;
  user_id: number;
  name: string;
  description: string;
  definition_json: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class BacktestStrategiesRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backtest_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        definition_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );
    `);
  }

  list(userId: number) {
    return (this.db.prepare("SELECT * FROM backtest_strategies WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as StrategyRow[])
      .map((row) => this.map(row));
  }

  get(userId: number, id: number) {
    const row = this.db.prepare("SELECT * FROM backtest_strategies WHERE user_id = ? AND id = ?").get(userId, id) as StrategyRow | undefined;
    if (!row) throw new NotFoundException("回测策略不存在");
    return this.map(row);
  }

  getByKey(userId: number, key: string) {
    const match = /^custom:(\d+)$/.exec(key);
    return match ? this.get(userId, Number(match[1])) : null;
  }

  create(userId: number, body: BacktestStrategyBody) {
    const input = this.normalize(body);
    const now = new Date().toISOString();
    try {
      const result = this.db.prepare(`INSERT INTO backtest_strategies
        (user_id, name, description, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(userId, input.name, input.description, JSON.stringify(input.definition), now, now);
      return this.get(userId, Number(result.lastInsertRowid));
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new BadRequestException("回测策略名称已存在");
      throw error;
    }
  }

  update(userId: number, id: number, body: BacktestStrategyBody) {
    this.get(userId, id);
    const input = this.normalize(body);
    try {
      this.db.prepare(`UPDATE backtest_strategies SET name = ?, description = ?, definition_json = ?, updated_at = ?
        WHERE user_id = ? AND id = ?`)
        .run(input.name, input.description, JSON.stringify(input.definition), new Date().toISOString(), userId, id);
      return this.get(userId, id);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new BadRequestException("回测策略名称已存在");
      throw error;
    }
  }

  remove(userId: number, id: number) {
    this.get(userId, id);
    this.db.prepare("DELETE FROM backtest_strategies WHERE user_id = ? AND id = ?").run(userId, id);
  }

  private normalize(body: BacktestStrategyBody) {
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    if (!name || name.length > 80) throw new BadRequestException("策略名称长度必须为 1-80 个字符");
    if (!body.definition || typeof body.definition !== "object" || Array.isArray(body.definition)) {
      throw new BadRequestException("definition 必须是 JSON 对象");
    }
    return { name, description, definition: body.definition as Record<string, unknown> };
  }

  private map(row: StrategyRow) {
    return {
      id: row.id,
      key: `custom:${row.id}`,
      name: row.name,
      label: row.name,
      description: row.description,
      definition: JSON.parse(row.definition_json) as Record<string, unknown>,
      default_params: {},
      source: "custom",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
