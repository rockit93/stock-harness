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
  stock_name: string | null;
  name: string | null;
  remark: string | null;
  subscribed_by: string | null;
  created_at: string;
};

type SubscriptionBody = {
  market?: string;
  symbol?: string;
  stockName?: string;
  name?: string;
  remark?: string;
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
    this.ensureColumn("subscriptions", "stock_name", "TEXT");
    this.ensureColumn("subscriptions", "remark", "TEXT");
    this.ensureColumn("subscriptions", "subscribed_by", "TEXT");
    this.db.exec("UPDATE subscriptions SET remark = name WHERE remark IS NULL AND name IS NOT NULL;");
  }

  list(userId: number) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, market, symbol, stock_name, name, remark, subscribed_by, created_at
         FROM subscriptions
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(userId) as SubscriptionRow[];
    return rows.map((row) => this.mapRow(row));
  }

  create(userId: number, subscribedBy: string, body: SubscriptionBody) {
    const market = String(body.market ?? "").trim();
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    const stockName = String(body.stockName ?? body.name ?? "").trim();
    const remark = String(body.remark ?? "").trim() || null;

    if (!["A Share", "Hong Kong", "US"].includes(market)) {
      throw new BadRequestException("市场必须是 A Share、Hong Kong 或 US");
    }
    if (!symbol) {
      throw new BadRequestException("股票代码不能为空");
    }
    if (!stockName) {
      throw new BadRequestException("股票名称不能为空，请先查询或手动填写");
    }

    try {
      const createdAt = new Date().toISOString();
      const result = this.db
        .prepare(
          `INSERT INTO subscriptions
           (user_id, market, symbol, stock_name, name, remark, subscribed_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(userId, market, symbol, stockName, remark, remark, subscribedBy, createdAt);
      return {
        id: Number(result.lastInsertRowid),
        userId,
        market,
        symbol,
        stockName,
        name: remark,
        remark,
        subscribedBy,
        createdAt,
      };
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

  private ensureColumn(table: string, column: string, type: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    }
  }

  private mapRow(row: SubscriptionRow) {
    const remark = row.remark ?? row.name ?? null;
    return {
      id: row.id,
      userId: row.user_id,
      market: row.market,
      symbol: row.symbol,
      stockName: row.stock_name ?? "",
      name: remark,
      remark,
      subscribedBy: row.subscribed_by ?? "",
      createdAt: row.created_at,
    };
  }
}
