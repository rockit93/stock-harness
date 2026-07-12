import { Injectable } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type CachedSymbol = { market: string; symbol: string; name: string };

@Injectable()
export class SymbolCacheRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`CREATE TABLE IF NOT EXISTS symbol_directory (
      market TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (market, symbol)
    );`);
  }

  search(market: string, keyword: string, limit: number) {
    const query = `%${keyword.trim()}%`;
    return (this.db.prepare(
      `SELECT market, symbol, stock_name AS name FROM symbol_directory
       WHERE market = ? AND (symbol LIKE ? OR stock_name LIKE ?)
       ORDER BY CASE WHEN symbol = ? THEN 0 WHEN stock_name = ? THEN 1 ELSE 2 END, symbol LIMIT ?`,
    ).all(market, query, query, keyword.trim().toUpperCase(), keyword.trim(), limit) as CachedSymbol[]);
  }

  upsert(items: CachedSymbol[]) {
    const statement = this.db.prepare(`INSERT INTO symbol_directory (market, symbol, stock_name, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(market, symbol) DO UPDATE SET stock_name = excluded.stock_name, updated_at = excluded.updated_at`);
    const now = new Date().toISOString();
    for (const item of items) if (item.market && item.symbol && item.name) statement.run(item.market, item.symbol.toUpperCase(), item.name, now);
  }
}
