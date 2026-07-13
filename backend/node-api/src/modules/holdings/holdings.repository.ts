import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type HoldingBody = { market?: string; symbol?: string; stockName?: string; shares?: number; costAmount?: number; source?: string; strategyId?: number | null; strategyName?: string };

@Injectable()
export class HoldingsRepository {
  private readonly db: DatabaseSync;
  constructor() {
    const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, portfolio_type TEXT NOT NULL,
      market TEXT NOT NULL, symbol TEXT NOT NULL, stock_name TEXT NOT NULL DEFAULT '', shares REAL NOT NULL,
      cost_amount REAL NOT NULL, source TEXT NOT NULL DEFAULT 'manual', strategy_id INTEGER, strategy_name TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, portfolio_type, market, symbol)
    )`);
  }
  list(userId: number, type: string) {
    return (this.db.prepare("SELECT * FROM portfolio_holdings WHERE user_id=? AND portfolio_type=? ORDER BY updated_at DESC,id DESC").all(userId, this.type(type)) as any[]).map(this.map);
  }
  upsert(userId: number, type: string, body: HoldingBody) {
    const portfolioType = this.type(type); const market = String(body.market || "A Share").trim();
    const symbol = String(body.symbol || "").trim().toUpperCase(); const stockName = String(body.stockName || "").trim();
    const shares = Number(body.shares); const costAmount = Number(body.costAmount);
    if (!symbol) throw new BadRequestException("股票代码不能为空");
    if (!Number.isFinite(shares) || shares < 0) throw new BadRequestException("股数必须是非负数");
    if (!Number.isFinite(costAmount) || costAmount < 0) throw new BadRequestException("成本金额必须是非负数");
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO portfolio_holdings (user_id,portfolio_type,market,symbol,stock_name,shares,cost_amount,source,strategy_id,strategy_name,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,portfolio_type,market,symbol) DO UPDATE SET stock_name=excluded.stock_name,shares=excluded.shares,cost_amount=excluded.cost_amount,source=excluded.source,strategy_id=excluded.strategy_id,strategy_name=excluded.strategy_name,updated_at=excluded.updated_at`)
      .run(userId, portfolioType, market, symbol, stockName, shares, costAmount, String(body.source || "manual"), body.strategyId || null, String(body.strategyName || "").trim() || null, now, now);
    return this.map(this.db.prepare("SELECT * FROM portfolio_holdings WHERE user_id=? AND portfolio_type=? AND market=? AND symbol=?").get(userId, portfolioType, market, symbol));
  }
  importMany(userId: number, bodies: HoldingBody[]) {
    if (!Array.isArray(bodies) || !bodies.length || bodies.length > 100) throw new BadRequestException("请提供 1 至 100 条持仓");
    this.db.exec("BEGIN"); try { const rows = bodies.map((body) => this.upsert(userId, "personal", { ...body, source: "vision" })); this.db.exec("COMMIT"); return rows; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  remove(userId: number, id: number) { const r = this.db.prepare("DELETE FROM portfolio_holdings WHERE user_id=? AND id=?").run(userId, id); if (!r.changes) throw new NotFoundException("持仓不存在"); }
  private type(value: string) { if (!['personal','paper'].includes(value)) throw new BadRequestException("持仓类型无效"); return value; }
  private map(row: any) { return { id: row.id, type: row.portfolio_type, market: row.market, symbol: row.symbol, stockName: row.stock_name, shares: Number(row.shares), costAmount: Number(row.cost_amount), averageCost: row.shares ? Number(row.cost_amount) / Number(row.shares) : 0, source: row.source, strategyId: row.strategy_id, strategyName: row.strategy_name, createdAt: row.created_at, updatedAt: row.updated_at }; }
}
