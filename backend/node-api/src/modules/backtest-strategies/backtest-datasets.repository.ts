import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type BacktestDatasetBody = { name?: string; description?: string; market?: string; symbols?: unknown };
export type DatasetImportBody = { sourceType?: string; sourceName?: string; columns?: unknown; rows?: unknown };
type DatasetRow = { id: number; user_id: number; name: string; description: string; market: string; symbols_json: string; source_type?: string; source_name?: string; columns_json?: string; row_count?: number; date_start?: string; date_end?: string; created_at: string; updated_at: string };

@Injectable()
export class BacktestDatasetsRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`CREATE TABLE IF NOT EXISTS backtest_datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', market TEXT NOT NULL, symbols_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, name)
    )`);
    for (const sql of ["ALTER TABLE backtest_datasets ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'", "ALTER TABLE backtest_datasets ADD COLUMN source_name TEXT NOT NULL DEFAULT ''", "ALTER TABLE backtest_datasets ADD COLUMN columns_json TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE backtest_datasets ADD COLUMN row_count INTEGER NOT NULL DEFAULT 0", "ALTER TABLE backtest_datasets ADD COLUMN date_start TEXT", "ALTER TABLE backtest_datasets ADD COLUMN date_end TEXT"]) {
      try { this.db.exec(sql); } catch (error) { if (!String(error).includes("duplicate column")) throw error; }
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS backtest_dataset_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      row_index INTEGER NOT NULL, trade_date TEXT, symbol TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
      data_json TEXT NOT NULL, UNIQUE(dataset_id, row_index)
    ); CREATE INDEX IF NOT EXISTS idx_backtest_dataset_rows_page ON backtest_dataset_rows(user_id,dataset_id,row_index);`);
  }

  list(userId: number) {
    return (this.db.prepare("SELECT * FROM backtest_datasets WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as DatasetRow[]).map((row) => this.map(row));
  }
  get(userId: number, id: number) {
    const row = this.db.prepare("SELECT * FROM backtest_datasets WHERE user_id = ? AND id = ?").get(userId, id) as DatasetRow | undefined;
    if (!row) throw new NotFoundException("回测数据集不存在");
    return this.map(row);
  }
  create(userId: number, body: BacktestDatasetBody) {
    const input = this.normalize(body); const now = new Date().toISOString();
    try {
      const result = this.db.prepare("INSERT INTO backtest_datasets (user_id,name,description,market,symbols_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run(userId, input.name, input.description, input.market, JSON.stringify(input.symbols), now, now);
      return this.get(userId, Number(result.lastInsertRowid));
    } catch (error) { if (String(error).includes("UNIQUE")) throw new BadRequestException("回测数据集名称已存在"); throw error; }
  }
  update(userId: number, id: number, body: BacktestDatasetBody) {
    this.get(userId, id); const input = this.normalize(body);
    try {
      this.db.prepare("UPDATE backtest_datasets SET name=?,description=?,market=?,symbols_json=?,updated_at=? WHERE user_id=? AND id=?")
        .run(input.name, input.description, input.market, JSON.stringify(input.symbols), new Date().toISOString(), userId, id);
      return this.get(userId, id);
    } catch (error) { if (String(error).includes("UNIQUE")) throw new BadRequestException("回测数据集名称已存在"); throw error; }
  }
  remove(userId: number, id: number) { this.get(userId, id); this.db.exec("BEGIN"); try { this.db.prepare("DELETE FROM backtest_dataset_rows WHERE user_id=? AND dataset_id=?").run(userId, id); this.db.prepare("DELETE FROM backtest_datasets WHERE user_id=? AND id=?").run(userId, id); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } }

  importRows(userId: number, id: number, body: DatasetImportBody) {
    const existing = this.get(userId, id);
    if (!Array.isArray(body.rows) || !body.rows.length) throw new BadRequestException("导入数据不能为空");
    if (body.rows.length > 100000) throw new BadRequestException("单个数据集最多导入 100,000 行");
    const fallbackSymbol = existing.symbols.length === 1 ? existing.symbols[0] : "";
    const rows = body.rows.map((value, index) => { const row = this.normalizeRow(value, index); if (!row.symbol) { row.symbol = fallbackSymbol; row.data.symbol = fallbackSymbol; } return row; });
    const columns = Array.isArray(body.columns) ? body.columns.map(String) : Object.keys(rows[0].data);
    const symbols = [...new Set(rows.map((row) => row.symbol).filter(Boolean))];
    if (symbols.length !== 1) throw new BadRequestException("当前回测引擎要求一个数据集只包含一个股票代码");
    if (existing.symbols.length === 1 && symbols[0] !== existing.symbols[0]) throw new BadRequestException(`导入数据的股票代码 ${symbols[0]} 与数据集 ${existing.symbols[0]} 不一致`);
    const dates = rows.map((row) => row.tradeDate).filter(Boolean).sort();
    const insert = this.db.prepare("INSERT INTO backtest_dataset_rows (dataset_id,user_id,row_index,trade_date,symbol,open,high,low,close,volume,data_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM backtest_dataset_rows WHERE user_id=? AND dataset_id=?").run(userId, id);
      rows.forEach((row, index) => insert.run(id, userId, index + 1, row.tradeDate || null, row.symbol || null, row.open, row.high, row.low, row.close, row.volume, JSON.stringify(row.data)));
      this.db.prepare("UPDATE backtest_datasets SET source_type=?,source_name=?,columns_json=?,row_count=?,date_start=?,date_end=?,symbols_json=?,updated_at=? WHERE user_id=? AND id=?")
        .run(String(body.sourceType || "file"), String(body.sourceName || ""), JSON.stringify(columns), rows.length, dates[0] || null, dates.at(-1) || null, JSON.stringify(symbols), new Date().toISOString(), userId, id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.get(userId, id);
  }

  rows(userId: number, id: number, pageInput: number, pageSizeInput: number) {
    const dataset = this.get(userId, id); const pageSize = Math.max(10, Math.min(200, pageSizeInput || 50)); const page = Math.max(1, pageInput || 1);
    const values = this.db.prepare("SELECT data_json FROM backtest_dataset_rows WHERE user_id=? AND dataset_id=? ORDER BY row_index LIMIT ? OFFSET ?").all(userId, id, pageSize, (page - 1) * pageSize) as Array<{ data_json: string }>;
    return { dataset, rows: values.map((row) => JSON.parse(row.data_json)), page, pageSize, total: dataset.rowCount };
  }
  bars(userId: number, id: number, symbol: string) {
    this.get(userId, id);
    const rows = this.db.prepare("SELECT trade_date date,open,high,low,close,volume FROM backtest_dataset_rows WHERE user_id=? AND dataset_id=? AND symbol=? ORDER BY trade_date").all(userId, id, symbol) as Array<Record<string, unknown>>;
    if (!rows.length) throw new NotFoundException(`数据集中没有 ${symbol} 的行情明细`);
    return rows;
  }

  private normalize(body: BacktestDatasetBody) {
    const name = String(body.name ?? "").trim(); const description = String(body.description ?? "").trim();
    const market = String(body.market ?? "").trim();
    const symbols = [...new Set((Array.isArray(body.symbols) ? body.symbols : []).map(String).map((item) => item.trim()).filter(Boolean))];
    if (!name || name.length > 80) throw new BadRequestException("数据集名称长度必须为 1-80 个字符");
    if (!["A Share", "Hong Kong", "US"].includes(market)) throw new BadRequestException("不支持的数据集市场");
    if (symbols.length !== 1) throw new BadRequestException("当前回测引擎要求一个数据集只包含一个股票代码");
    return { name, description, market, symbols };
  }
  private normalizeRow(value: unknown, index: number) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`第 ${index + 1} 行不是有效记录`);
    const source = value as Record<string, unknown>; const lower = Object.fromEntries(Object.entries(source).map(([key, val]) => [key.trim().toLowerCase(), val]));
    const pick = (...keys: string[]) => keys.map((key) => lower[key]).find((item) => item !== undefined && item !== null && item !== "");
    const number = (...keys: string[]) => { const raw = pick(...keys); const parsed = raw === undefined ? null : Number(raw); return Number.isFinite(parsed) ? parsed : null; };
    const dateRaw = pick("date", "datetime", "time", "trade_date", "交易日期", "日期", "时间");
    const symbol = String(pick("symbol", "code", "ticker", "stock_code", "股票代码", "代码") ?? "").trim();
    const data = { ...source } as Record<string, unknown>;
    return { data, tradeDate: dateRaw === undefined ? "" : String(dateRaw).trim(), symbol, open: number("open", "开盘", "开盘价"), high: number("high", "最高", "最高价"), low: number("low", "最低", "最低价"), close: number("close", "收盘", "收盘价"), volume: number("volume", "vol", "成交量") };
  }
  private map(row: DatasetRow) { return { id: row.id, name: row.name, description: row.description, market: row.market, symbols: JSON.parse(row.symbols_json), sourceType: row.source_type || "manual", sourceName: row.source_name || "", columns: JSON.parse(row.columns_json || "[]"), rowCount: Number(row.row_count || 0), dateStart: row.date_start || null, dateEnd: row.date_end || null, createdAt: row.created_at, updatedAt: row.updated_at }; }
}
