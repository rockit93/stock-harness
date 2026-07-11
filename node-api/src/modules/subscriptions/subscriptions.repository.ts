import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type SubscriptionRow = {
  id: number;
  user_id: number;
  market: string;
  symbol: string;
  name: string | null;
  created_at: string;
};

@Injectable()
export class SubscriptionsRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        market TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, market, symbol)
      );
    `);
  }

  list(userId: number) {
    const rows = this.db
      .prepare("SELECT id, user_id, market, symbol, name, created_at FROM subscriptions WHERE user_id = ? ORDER BY market, symbol")
      .all(userId) as SubscriptionRow[];
    return rows.map((row) => this.mapRow(row));
  }

  create(userId: number, body: { market?: string; symbol?: string; name?: string }) {
    const market = String(body.market ?? "").trim();
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim() || null;

    if (!["A Share", "Hong Kong", "US"].includes(market)) {
      throw new BadRequestException("市场必须是 A Share、Hong Kong 或 US");
    }
    if (!symbol) {
      throw new BadRequestException("股票代码不能为空");
    }

    try {
      const createdAt = new Date().toISOString();
      const result = this.db
        .prepare("INSERT INTO subscriptions (user_id, market, symbol, name, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, market, symbol, name, createdAt);
      return { id: Number(result.lastInsertRowid), userId, market, symbol, name, createdAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("UNIQUE")) {
        throw new ConflictException("该股票已订阅");
      }
      throw error;
    }
  }

  remove(userId: number, id: number) {
    this.db.prepare("DELETE FROM subscriptions WHERE user_id = ? AND id = ?").run(userId, id);
  }

  private mapRow(row: SubscriptionRow) {
    return {
      id: row.id,
      userId: row.user_id,
      market: row.market,
      symbol: row.symbol,
      name: row.name,
      createdAt: row.created_at,
    };
  }
}
