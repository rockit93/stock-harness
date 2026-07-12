import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export type StrategyCondition = {
  metric: string;
  op: ">" | ">=" | "<" | "<=" | "==" | "!=";
  value: number;
};

export type StrategyBody = {
  name?: string;
  targetLabel?: string;
  conditions?: StrategyCondition[];
  enabled?: boolean;
};

export type StrategyTemplate = {
  key: string;
  name: string;
  targetLabel: string;
  description: string;
  conditions: StrategyCondition[];
};

export type BindingBody = {
  subscriptionId?: number;
  subscriptionIds?: number[];
  strategyId?: number;
  periodMinutes?: number;
  scope?: "selected" | "single" | "all";
  activeSessions?: TradingSession[];
};

export type TradingSession = "pre_market" | "market" | "post_market";

const templatesDir = path.dirname(fileURLToPath(import.meta.url));
const templateConfigPath = [
  path.join(templatesDir, "label-strategy-templates.json"),
  path.resolve(process.cwd(), "src/modules/label-strategies/label-strategy-templates.json"),
  path.resolve(process.cwd(), "backend/node-api/src/modules/label-strategies/label-strategy-templates.json"),
].find(existsSync);
if (!templateConfigPath) throw new Error("Label strategy template config is missing");
const CONFIGURED_LABEL_STRATEGY_TEMPLATES = JSON.parse(
  readFileSync(templateConfigPath, "utf8"),
) as StrategyTemplate[];

type StrategyRow = {
  id: number;
  user_id: number;
  name: string;
  target_label: string;
  conditions_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type BindingRow = {
  id: number;
  user_id: number;
  subscription_id: number;
  strategy_id: number;
  period_minutes: number;
  active_sessions_json: string;
  latest_label: string | null;
  latest_reason: string | null;
  latest_payload_json: string | null;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
  strategy_name?: string;
  target_label?: string;
  market?: string;
  symbol?: string;
  stock_name?: string | null;
};

@Injectable()
export class LabelStrategiesRepository {
  private readonly db: DatabaseSync;

  constructor() {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const dataDir = path.resolve(dirname, "../../../data");
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "auth.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS label_strategies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        target_label TEXT NOT NULL,
        conditions_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stock_label_strategy_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        subscription_id INTEGER NOT NULL,
        strategy_id INTEGER NOT NULL,
        period_minutes INTEGER NOT NULL,
        latest_label TEXT,
        latest_reason TEXT,
        latest_payload_json TEXT,
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, subscription_id, strategy_id)
      );
    `);
    this.ensureColumn("stock_label_strategy_bindings", "active_sessions_json", "TEXT NOT NULL DEFAULT '[\"market\"]'");
  }

  listStrategies(userId: number) {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, target_label, conditions_json, enabled, created_at, updated_at
         FROM label_strategies
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(userId) as StrategyRow[];
    return rows.map((row) => this.mapStrategy(row));
  }

  listTemplates() {
    return CONFIGURED_LABEL_STRATEGY_TEMPLATES;
  }

  createStrategyFromTemplate(userId: number, key: string) {
    const template = CONFIGURED_LABEL_STRATEGY_TEMPLATES.find((item) => item.key === key);
    if (!template) throw new NotFoundException("策略模板不存在");
    return this.createStrategy(userId, {
      name: template.name,
      targetLabel: template.targetLabel,
      conditions: template.conditions,
      enabled: true,
    });
  }

  createStrategy(userId: number, body: StrategyBody) {
    const name = String(body.name ?? "").trim();
    const targetLabel = String(body.targetLabel ?? "").trim();
    const conditions = this.normalizeConditions(body.conditions);
    if (!name) throw new BadRequestException("策略名称不能为空");
    if (!targetLabel) throw new BadRequestException("命中标签不能为空");
    if (!conditions.length) throw new BadRequestException("至少配置一条命中条件");

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO label_strategies
         (user_id, name, target_label, conditions_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, name, targetLabel, JSON.stringify(conditions), body.enabled === false ? 0 : 1, now, now);
    return this.getStrategy(userId, Number(result.lastInsertRowid));
  }

  updateStrategy(userId: number, id: number, body: StrategyBody) {
    const current = this.getStrategy(userId, id);
    const name = body.name === undefined ? current.name : String(body.name).trim();
    const targetLabel = body.targetLabel === undefined ? current.targetLabel : String(body.targetLabel).trim();
    const conditions = body.conditions === undefined ? current.conditions : this.normalizeConditions(body.conditions);
    if (!name || !targetLabel || !conditions.length) throw new BadRequestException("策略名称、命中标签和条件不能为空");
    const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
    this.db.prepare(
      `UPDATE label_strategies SET name = ?, target_label = ?, conditions_json = ?, enabled = ?, updated_at = ? WHERE user_id = ? AND id = ?`,
    ).run(name, targetLabel, JSON.stringify(conditions), enabled ? 1 : 0, new Date().toISOString(), userId, id);
    return this.getStrategy(userId, id);
  }

  removeStrategy(userId: number, id: number) {
    this.db.prepare("DELETE FROM stock_label_strategy_bindings WHERE user_id = ? AND strategy_id = ?").run(userId, id);
    this.db.prepare("DELETE FROM label_strategies WHERE user_id = ? AND id = ?").run(userId, id);
  }

  getStrategy(userId: number, id: number) {
    const row = this.db
      .prepare(
        `SELECT id, user_id, name, target_label, conditions_json, enabled, created_at, updated_at
         FROM label_strategies
         WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as StrategyRow | undefined;
    if (!row) throw new NotFoundException("策略不存在");
    return this.mapStrategy(row);
  }

  listBindings(userId: number) {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.user_id, b.subscription_id, b.strategy_id, b.period_minutes, b.active_sessions_json,
                b.latest_label, b.latest_reason, b.latest_payload_json, b.last_run_at,
                b.next_run_at, b.created_at,
                s.name AS strategy_name, s.target_label,
                sub.market, sub.symbol, sub.stock_name
         FROM stock_label_strategy_bindings b
         JOIN label_strategies s ON s.id = b.strategy_id AND s.user_id = b.user_id
         JOIN subscriptions sub ON sub.id = b.subscription_id AND sub.user_id = b.user_id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC, b.id DESC`,
      )
      .all(userId) as BindingRow[];
    return rows.map((row) => this.mapBinding(row));
  }

  listBindingsForStrategy(userId: number, strategyId: number) {
    this.getStrategy(userId, strategyId);
    return this.listBindings(userId).filter((binding) => binding.strategyId === strategyId);
  }

  listLabelsBySubscription(userId: number) {
    const bindings = this.listBindings(userId);
    const groups: Record<string, unknown[]> = {};
    for (const binding of bindings) {
      if (!binding.latestLabel) continue;
      const key = String(binding.subscriptionId);
      groups[key] ??= [];
      groups[key].push(binding);
    }
    return groups;
  }

  createBinding(userId: number, body: BindingBody) {
    const strategyId = Number(body.strategyId);
    const periodMinutes = Number(body.periodMinutes ?? 1440);
    const scope = body.scope === "all" ? "all" : "selected";
    const activeSessions = this.normalizeSessions(body.activeSessions);
    if (!Number.isInteger(strategyId) || strategyId <= 0) throw new BadRequestException("策略无效");
    if (!Number.isInteger(periodMinutes) || periodMinutes < 5) throw new BadRequestException("执行周期至少 5 分钟");

    this.getStrategy(userId, strategyId);
    const subscriptions = this.db.prepare("SELECT id FROM subscriptions WHERE user_id = ? ORDER BY id").all(userId) as Array<{ id: number }>;
    const requestedIds = body.subscriptionIds ?? (body.subscriptionId === undefined ? [] : [body.subscriptionId]);
    const subscriptionIds = scope === "all"
      ? subscriptions.map((subscription) => subscription.id)
      : [...new Set(requestedIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!subscriptionIds.length) throw new BadRequestException(scope === "all" ? "暂无可应用的订阅股票" : "请至少选择一只订阅股票");
    subscriptionIds.forEach((subscriptionId) => this.assertSubscription(userId, subscriptionId));

    const placeholders = subscriptionIds.map(() => "?").join(", ");
    this.db.prepare(
      `DELETE FROM stock_label_strategy_bindings
       WHERE user_id = ? AND strategy_id = ? AND subscription_id NOT IN (${placeholders})`,
    ).run(userId, strategyId, ...subscriptionIds);
    const bindings = subscriptionIds.map((subscriptionId) =>
      this.upsertBinding(userId, subscriptionId, strategyId, periodMinutes, activeSessions),
    );
    return { scope, count: bindings.length, bindings };
  }

  private upsertBinding(userId: number, subscriptionId: number, strategyId: number, periodMinutes: number, activeSessions: TradingSession[]) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO stock_label_strategy_bindings
         (user_id, subscription_id, strategy_id, period_minutes, active_sessions_json, next_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, subscription_id, strategy_id) DO UPDATE SET
           period_minutes = excluded.period_minutes,
           active_sessions_json = excluded.active_sessions_json,
           next_run_at = excluded.next_run_at`,
      )
      .run(userId, subscriptionId, strategyId, periodMinutes, JSON.stringify(activeSessions), now, now);
    const id = Number(result.lastInsertRowid) || this.findBindingId(userId, subscriptionId, strategyId);
    return this.getBinding(userId, id);
  }

  removeBinding(userId: number, id: number) {
    this.db.prepare("DELETE FROM stock_label_strategy_bindings WHERE user_id = ? AND id = ?").run(userId, id);
  }

  getBinding(userId: number, id: number) {
    const row = this.db
      .prepare(
        `SELECT b.id, b.user_id, b.subscription_id, b.strategy_id, b.period_minutes, b.active_sessions_json,
                b.latest_label, b.latest_reason, b.latest_payload_json, b.last_run_at,
                b.next_run_at, b.created_at,
                s.name AS strategy_name, s.target_label,
                sub.market, sub.symbol, sub.stock_name
         FROM stock_label_strategy_bindings b
         JOIN label_strategies s ON s.id = b.strategy_id AND s.user_id = b.user_id
         JOIN subscriptions sub ON sub.id = b.subscription_id AND sub.user_id = b.user_id
         WHERE b.user_id = ? AND b.id = ?`,
      )
      .get(userId, id) as BindingRow | undefined;
    if (!row) throw new NotFoundException("策略绑定不存在");
    return this.mapBinding(row);
  }

  dueBindings(limit = 20) {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.user_id, b.subscription_id, b.strategy_id, b.period_minutes, b.active_sessions_json,
                b.latest_label, b.latest_reason, b.latest_payload_json, b.last_run_at,
                b.next_run_at, b.created_at,
                s.name AS strategy_name, s.target_label,
                sub.market, sub.symbol, sub.stock_name
         FROM stock_label_strategy_bindings b
         JOIN label_strategies s ON s.id = b.strategy_id AND s.user_id = b.user_id
         JOIN subscriptions sub ON sub.id = b.subscription_id AND sub.user_id = b.user_id
         WHERE s.enabled = 1 AND b.next_run_at <= ?
         ORDER BY b.next_run_at ASC
         LIMIT ?`,
      )
      .all(new Date().toISOString(), limit) as BindingRow[];
    return rows.map((row) => this.mapBinding(row));
  }

  markResult(userId: number, id: number, hit: boolean, label: string | null, reason: string, payload: unknown, periodMinutes: number) {
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + periodMinutes * 60_000).toISOString();
    this.db
      .prepare(
        `UPDATE stock_label_strategy_bindings
         SET latest_label = ?, latest_reason = ?, latest_payload_json = ?,
             last_run_at = ?, next_run_at = ?
         WHERE user_id = ? AND id = ?`,
      )
      .run(hit ? label : null, reason, JSON.stringify(payload), now.toISOString(), nextRunAt, userId, id);
  }

  markFailure(userId: number, id: number, reason: string, periodMinutes: number) {
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + Math.max(periodMinutes, 5) * 60_000).toISOString();
    this.db
      .prepare(
        `UPDATE stock_label_strategy_bindings
         SET latest_reason = ?, last_run_at = ?, next_run_at = ?
         WHERE user_id = ? AND id = ?`,
      )
      .run(reason, now.toISOString(), nextRunAt, userId, id);
  }

  private findBindingId(userId: number, subscriptionId: number, strategyId: number) {
    const row = this.db
      .prepare("SELECT id FROM stock_label_strategy_bindings WHERE user_id = ? AND subscription_id = ? AND strategy_id = ?")
      .get(userId, subscriptionId, strategyId) as { id: number } | undefined;
    if (!row) throw new NotFoundException("策略绑定不存在");
    return row.id;
  }

  private assertSubscription(userId: number, subscriptionId: number) {
    const row = this.db.prepare("SELECT id FROM subscriptions WHERE user_id = ? AND id = ?").get(userId, subscriptionId);
    if (!row) throw new BadRequestException("订阅股票不存在");
  }

  private normalizeSessions(input: TradingSession[] | undefined): TradingSession[] {
    const valid = new Set<TradingSession>(["pre_market", "market", "post_market"]);
    const sessions = [...new Set((input ?? ["market"]).filter((item): item is TradingSession => valid.has(item)))];
    if (!sessions.length) throw new BadRequestException("至少选择一个生效时段");
    return sessions;
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }

  private normalizeConditions(input: StrategyCondition[] | undefined) {
    const validMetrics = new Set(["revenue", "net_income", "roe", "operating_cash_flow", "pe", "debt_ratio", "dividend_yield"]);
    const validOps = new Set([">", ">=", "<", "<=", "==", "!="]);
    return (input ?? [])
      .map((condition) => ({
        metric: String(condition.metric ?? "").trim(),
        op: String(condition.op ?? "").trim() as StrategyCondition["op"],
        value: Number(condition.value),
      }))
      .filter((condition) => validMetrics.has(condition.metric) && validOps.has(condition.op) && Number.isFinite(condition.value));
  }

  private mapStrategy(row: StrategyRow) {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      targetLabel: row.target_label,
      conditions: JSON.parse(row.conditions_json) as StrategyCondition[],
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapBinding(row: BindingRow) {
    return {
      id: row.id,
      userId: row.user_id,
      subscriptionId: row.subscription_id,
      strategyId: row.strategy_id,
      periodMinutes: row.period_minutes,
      activeSessions: JSON.parse(row.active_sessions_json || '["market"]') as TradingSession[],
      latestLabel: row.latest_label,
      latestReason: row.latest_reason,
      latestPayload: row.latest_payload_json ? JSON.parse(row.latest_payload_json) : null,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      strategyName: row.strategy_name ?? "",
      targetLabel: row.target_label ?? "",
      market: row.market ?? "",
      symbol: row.symbol ?? "",
      stockName: row.stock_name ?? "",
    };
  }
}
