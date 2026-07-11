import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { mkdirSync } from "node:fs";
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
  strategyId?: number;
  periodMinutes?: number;
};

export const DEFAULT_LABEL_STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    key: "good-cash-compounder",
    name: "高 ROE 现金牛",
    targetLabel: "好公司",
    description: "盈利质量较稳，ROE 较高且经营现金流为正。",
    conditions: [
      { metric: "roe", op: ">=", value: 0.15 },
      { metric: "operating_cash_flow", op: ">", value: 0 },
      { metric: "net_income", op: ">", value: 0 },
    ],
  },
  {
    key: "expensive-quality",
    name: "高估值优质股",
    targetLabel: "贵公司",
    description: "质量不错，但 PE 已经不便宜，需要更高增长来消化估值。",
    conditions: [
      { metric: "roe", op: ">=", value: 0.15 },
      { metric: "pe", op: ">=", value: 40 },
      { metric: "net_income", op: ">", value: 0 },
    ],
  },
  {
    key: "danger-balance-sheet",
    name: "高负债现金流压力",
    targetLabel: "危险公司",
    description: "负债率偏高，并且经营现金流或盈利表现不佳。",
    conditions: [
      { metric: "debt_ratio", op: ">=", value: 0.7 },
      { metric: "operating_cash_flow", op: "<=", value: 0 },
    ],
  },
  {
    key: "cheap-with-caveat",
    name: "低 PE 质量存疑",
    targetLabel: "便宜但有坑的公司",
    description: "PE 很低，但 ROE 偏弱，可能是价值陷阱，需要进一步排雷。",
    conditions: [
      { metric: "pe", op: "<=", value: 12 },
      { metric: "roe", op: "<", value: 0.1 },
    ],
  },
];

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
    return DEFAULT_LABEL_STRATEGY_TEMPLATES;
  }

  createStrategyFromTemplate(userId: number, key: string) {
    const template = DEFAULT_LABEL_STRATEGY_TEMPLATES.find((item) => item.key === key);
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
        `SELECT b.id, b.user_id, b.subscription_id, b.strategy_id, b.period_minutes,
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
    const subscriptionId = Number(body.subscriptionId);
    const strategyId = Number(body.strategyId);
    const periodMinutes = Number(body.periodMinutes ?? 1440);
    if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) throw new BadRequestException("订阅股票无效");
    if (!Number.isInteger(strategyId) || strategyId <= 0) throw new BadRequestException("策略无效");
    if (!Number.isInteger(periodMinutes) || periodMinutes < 5) throw new BadRequestException("执行周期至少 5 分钟");

    this.assertSubscription(userId, subscriptionId);
    this.getStrategy(userId, strategyId);

    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO stock_label_strategy_bindings
         (user_id, subscription_id, strategy_id, period_minutes, next_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, subscription_id, strategy_id) DO UPDATE SET
           period_minutes = excluded.period_minutes,
           next_run_at = excluded.next_run_at`,
      )
      .run(userId, subscriptionId, strategyId, periodMinutes, now, now);
    const id = Number(result.lastInsertRowid) || this.findBindingId(userId, subscriptionId, strategyId);
    return this.getBinding(userId, id);
  }

  removeBinding(userId: number, id: number) {
    this.db.prepare("DELETE FROM stock_label_strategy_bindings WHERE user_id = ? AND id = ?").run(userId, id);
  }

  getBinding(userId: number, id: number) {
    const row = this.db
      .prepare(
        `SELECT b.id, b.user_id, b.subscription_id, b.strategy_id, b.period_minutes,
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
        `SELECT b.id, b.user_id, b.subscription_id, b.strategy_id, b.period_minutes,
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
