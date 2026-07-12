import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PythonCoreService } from "../quant/python-core.service";
import { HttpDataSourceService } from "../quant/http-data-source.service";
import { SettingsRepository } from "../settings/settings.repository";
import { LabelStrategiesRepository, StrategyCondition } from "./label-strategies.repository";
import { isTradingSession, MarketPhase } from "./market-hours";

type FundamentalMetric = { key: string; value: number | null };
type FundamentalPayload = { metrics?: FundamentalMetric[]; source?: string; period?: string };
type Binding = ReturnType<LabelStrategiesRepository["getBinding"]>;

@Injectable()
export class LabelStrategiesService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(LabelStrategiesRepository) private readonly repository: LabelStrategiesRepository,
    @Inject(SettingsRepository) private readonly settings: SettingsRepository,
    @Inject(PythonCoreService) private readonly pythonCore: PythonCoreService,
    @Inject(HttpDataSourceService) private readonly httpSources: HttpDataSourceService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.runDue(), 60_000);
    void this.runDue();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  strategies(userId: number) {
    return this.repository.listStrategies(userId);
  }

  templates() {
    return this.repository.listTemplates();
  }

  createStrategy(userId: number, body: Parameters<LabelStrategiesRepository["createStrategy"]>[1]) {
    return this.repository.createStrategy(userId, body);
  }

  updateStrategy(userId: number, id: number, body: Parameters<LabelStrategiesRepository["updateStrategy"]>[2]) {
    return this.repository.updateStrategy(userId, id, body);
  }

  createStrategyFromTemplate(userId: number, key: string) {
    return this.repository.createStrategyFromTemplate(userId, key);
  }

  removeStrategy(userId: number, id: number) {
    this.repository.removeStrategy(userId, id);
  }

  bindings(userId: number) {
    return this.repository.listBindings(userId);
  }

  labels(userId: number) {
    return this.repository.listLabelsBySubscription(userId);
  }

  createBinding(userId: number, body: Parameters<LabelStrategiesRepository["createBinding"]>[1]) {
    return this.repository.createBinding(userId, body);
  }

  removeBinding(userId: number, id: number) {
    this.repository.removeBinding(userId, id);
  }

  async runBinding(userId: number, id: number) {
    const binding = this.repository.getBinding(userId, id);
    await this.executeBinding(binding);
    return this.repository.getBinding(userId, id);
  }

  async runStrategy(userId: number, strategyId: number) {
    const bindings = this.repository.listBindingsForStrategy(userId, strategyId);
    for (const binding of bindings) await this.executeBinding(binding);
    const updated = this.repository.listBindingsForStrategy(userId, strategyId);
    return {
      ok: true,
      strategyId,
      executed: updated.length,
      hit: updated.filter((binding) => Boolean(binding.latestLabel)).length,
      failed: updated.filter((binding) => String(binding.latestReason ?? "").startsWith("无法") || String(binding.latestReason ?? "").includes("失败")).length,
      bindings: updated,
    };
  }

  async runDue() {
    if (this.running) return;
    this.running = true;
    try {
      for (const binding of this.repository.dueBindings()) {
        if (!isTradingSession(binding.market, binding.activeSessions as MarketPhase[])) continue;
        await this.executeBinding(binding);
      }
    } finally {
      this.running = false;
    }
  }

  private async executeBinding(binding: Binding) {
    const strategy = this.repository.getStrategy(binding.userId, binding.strategyId);
    const settings = this.settings.get(binding.userId);
    try {
      const input = {
        market: binding.market,
        symbol: binding.symbol,
        data_source: settings.dataSource,
        futu_host: settings.futuHost,
        futu_port: settings.futuPort,
        provider_chains: Object.fromEntries(Object.entries(settings.providerChains).map(([market, chain]) => [market, chain.filter((key) => ["akshare", "baostock", "futu", "yfinance", "sec_edgar"].includes(key))])),
      };
      const custom = await this.httpSources.request(binding.userId, "fundamentals", input);
      const fundamentals = (custom.data ?? await this.pythonCore.fundamentals(input)) as FundamentalPayload;
      const result = this.evaluate(strategy.conditions, fundamentals);
      this.repository.markResult(
        binding.userId,
        binding.id,
        result.hit,
        strategy.targetLabel,
        result.reason,
        { fundamentals, strategy },
        binding.periodMinutes,
      );
    } catch (error) {
      this.repository.markFailure(binding.userId, binding.id, error instanceof Error ? error.message : String(error), binding.periodMinutes);
    }
  }

  private evaluate(conditions: StrategyCondition[], payload: FundamentalPayload) {
    const metrics = new Map((payload.metrics ?? []).map((metric) => [metric.key, Number(metric.value)]));
    const reasons: string[] = [];

    for (const condition of conditions) {
      const value = metrics.get(condition.metric);
      if (!Number.isFinite(value)) {
        return { hit: false, reason: `${condition.metric} 数据缺失` };
      }
      const numericValue = Number(value);
      const ok = this.compare(numericValue, condition.op, condition.value);
      reasons.push(`${condition.metric} ${condition.op} ${condition.value}，实际 ${numericValue}`);
      if (!ok) return { hit: false, reason: `未命中：${reasons.at(-1)}` };
    }

    return { hit: true, reason: `命中：${reasons.join("；")}` };
  }

  private compare(left: number, op: StrategyCondition["op"], right: number) {
    if (op === ">") return left > right;
    if (op === ">=") return left >= right;
    if (op === "<") return left < right;
    if (op === "<=") return left <= right;
    if (op === "==") return left === right;
    return left !== right;
  }
}
