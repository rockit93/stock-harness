import { createApp, nextTick } from "vue";
import { dispose, init } from "klinecharts";
import { AreaSeries, ColorType, createChart, LineSeries } from "lightweight-charts";
import { configStore, llmClient, registerProvider } from "@anvaka/vue-llm";
import "@anvaka/vue-llm/styles/variables.css";
import MarkdownIt from "markdown-it";
import { PI_RUNTIME_PROVIDER, PiRuntimeProvider } from "./piLlmProvider.js";
import { moduleRoutes, router } from "./router.js";
import "./style.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";
const dashboardCharts = new Map();
const backtestCharts = [];
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
registerProvider(PI_RUNTIME_PROVIDER, PiRuntimeProvider);

async function configurePiRuntimeClient(modelSettings) {
  const config = {
    id: PI_RUNTIME_PROVIDER,
    provider: PI_RUNTIME_PROVIDER,
    name: "Pi Runtime",
    baseUrl: API_BASE,
    model: modelSettings.model,
    temperature: modelSettings.temperature,
    maxTokens: modelSettings.maxOutputTokens,
    enabled: true,
  };
  configStore.saveConfig(PI_RUNTIME_PROVIDER, config);
  configStore.setActiveProviderId(PI_RUNTIME_PROVIDER);
  await llmClient.initialize(config);
}

function disposeDashboardChart(id) {
  const entry = dashboardCharts.get(id);
  if (!entry) return;
  entry.resizeObserver?.disconnect();
  dispose(entry.chart);
  dashboardCharts.delete(id);
}

function disposeDashboardCharts() {
  for (const id of [...dashboardCharts.keys()]) disposeDashboardChart(id);
}

function disposeBacktestCharts() {
  while (backtestCharts.length) {
    const entry = backtestCharts.pop();
    entry.resizeObserver.disconnect();
    entry.chart.remove();
  }
}

function createBacktestChart(container, priceFormatter) {
  const chart = createChart(container, {
    width: container.clientWidth,
    height: 300,
    layout: {
      background: { type: ColorType.Solid, color: "#ffffff" },
      textColor: "#64748b",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: "#eef2f7" },
      horzLines: { color: "#eef2f7" },
    },
    rightPriceScale: { borderColor: "#e2e8f0" },
    timeScale: { borderColor: "#e2e8f0", timeVisible: false },
    crosshair: { vertLine: { labelBackgroundColor: "#334155" }, horzLine: { labelBackgroundColor: "#334155" } },
    localization: { locale: "zh-CN", priceFormatter },
  });
  const resizeObserver = new ResizeObserver(() => chart.applyOptions({ width: container.clientWidth }));
  resizeObserver.observe(container);
  backtestCharts.push({ chart, resizeObserver });
  return chart;
}

const marketLabels = {
  "A Share": "A 股",
  "Hong Kong": "港股",
  US: "美股",
};

const strategyLabels = {
  ma_cross: "双均线交叉",
  rsi_mean_reversion: "RSI 均值回归",
};

const paramLabels = {
  fast: "快均线周期",
  slow: "慢均线周期",
  period: "指标周期",
  lower: "买入阈值",
  upper: "卖出阈值",
};

const fundamentalMetricLabels = {
  revenue: "营收",
  net_income: "净利润",
  roe: "ROE",
  operating_cash_flow: "经营现金流",
  pe: "PE",
  debt_ratio: "负债率",
  dividend_yield: "股息率",
};

function isoDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startForRange(range) {
  if (range === "day") return isoDate(5);
  if (range === "week") return isoDate(14);
  return isoDate(45);
}

const defaultPluginCode = `export default {
  name: "market-summary",
  async run(context) {
    return {
      message: "返回给 Pi Runtime 的结构化结果",
      input: context.input
    };
  }
};`;

const app = createApp({
  data() {
    return {
      token: localStorage.getItem("stock-harness-token") ?? sessionStorage.getItem("stock-harness-token") ?? "",
      authMode: "login",
      auth: { username: "admin", password: "", rememberMe: true },
      currentUser: null,
      activeModule: router.currentRoute.value.meta.module ?? "dashboard",
      loading: false,
      authLoading: false,
      dashboardLoading: false,
      lookupLoading: false,
      settingsSaving: false,
      error: "",
      settingsMessage: "",
      strategies: [],
      showBacktestStrategyEditor: false,
      backtestStrategyForm: {
        id: null,
        name: "双均线趋势策略",
        description: "短均线上穿长均线买入，下穿卖出。",
        definitionText: JSON.stringify({
          indicators: {
            fast: { type: "sma", period: 10 },
            slow: { type: "sma", period: 30 },
          },
          entry: { all: [{ left: "fast", op: "crosses_above", right: "slow" }] },
          exit: { all: [{ left: "fast", op: "crosses_below", right: "slow" }] },
          risk: { stop_loss_pct: 0.08, take_profit_pct: 0.2 },
        }, null, 2),
      },
      result: null,
      dataSourceSettings: {
        dataSource: "auto",
        futuHost: "127.0.0.1",
        futuPort: 11111,
        updatedAt: null,
      },
      modelSettings: {
        id: null,
        name: "本地 Qwen",
        provider: "ollama",
        model: "qwen2.5-coder:14b",
        baseUrl: "http://127.0.0.1:11434",
        apiKeyRef: "",
        temperature: 0.2,
        maxOutputTokens: 4096,
        contextBudgetTokens: 32768,
        reasoningEffort: "medium",
        updatedAt: null,
      },
      modelConfigs: [],
      roles: [],
      skills: [],
      plugins: [],
      roleForm: {
        name: "策略研究员",
        responsibility: "把用户的策略想法拆成可回测的规则和参数。",
        systemPrompt: "你是策略研究员，只输出可验证、可回测、可解释的策略方案。",
      },
      skillForm: {
        name: "",
        description: "",
        content: "",
        package: null,
      },
      skillUploadSummary: "",
      pluginForm: {
        id: null,
        name: "",
        description: "",
        sourceUrl: "",
        code: defaultPluginCode,
        package: null,
      },
      pluginUploadSummary: "",
      taskForm: {
        name: "盘后复盘",
        roleId: "",
        schedule: "manual",
        prompt: "总结订阅股票今天的走势、异常波动和明天观察点。",
        modelConfigId: "",
      },
      chatForm: {
        roleId: "",
        model: "",
        modelConfigId: "",
        message: "帮我分析 600519 最近的走势，并给出可回测的策略假设。",
      },
      savedTasks: JSON.parse(localStorage.getItem("stock-harness-pi-tasks") || "[]"),
      chatLoading: false,
      chatSessionId: null,
      chatMessages: [],
      chatReply: "",
      chatThinking: "",
      chatTrace: null,
      chatSidebarOpen: true,
      chatHistoryQuery: "",
      chatHistory: JSON.parse(localStorage.getItem("stock-harness-chat-history") || "[]"),
      chatStarters: [
        { icon: "⌁", title: "市场复盘", prompt: "总结今天关注标的的走势、异动和明日观察点。" },
        { icon: "↗", title: "策略研究", prompt: "基于我的订阅股票，提出一个可回测的交易策略假设。" },
        { icon: "◎", title: "风险检查", prompt: "检查当前关注标的可能存在的风险，并按重要性排序。" },
      ],
      availableModels: [],
      subscriptions: [],
      subscriptionForm: {
        market: "A Share",
        symbol: "600519",
        stockName: "",
        remark: "",
      },
      symbolSuggestions: [],
      selectedRange: "month",
      selectedInterval: "1d",
      chartLocale: "zh-CN",
      chartData: {},
      chartErrors: {},
      fundamentalData: {},
      fundamentalErrors: {},
      fundamentalMetricLabels,
      labelStrategyTemplates: [],
      labelStrategies: [],
      labelBindings: [],
      subscriptionLabels: {},
      labelStrategyRunId: null,
      labelStrategyMessage: "",
      isStrategyModalOpen: false,
      strategyForm: {
        name: "高 ROE 现金牛",
        targetLabel: "好公司",
        conditions: [
          { metric: "roe", op: ">=", value: 0.15 },
          { metric: "operating_cash_flow", op: ">", value: 0 },
        ],
      },
      bindingForm: {
        subscriptionId: "",
        strategyId: "",
      },
      bindingPeriodValue: 24,
      bindingPeriodUnit: "hours",
      form: {
        market: "A Share",
        symbol: "600519",
        start: "2020-01-01",
        end: isoDate(),
        adjust: "qfq",
        strategy: "ma_cross",
        strategy_params: { fast: 10, slow: 30 },
        cash: 100000,
        commission_bps: 3,
      },
    };
  },
  computed: {
    groupedSubscriptions() {
      const groups = { "A Share": [], "Hong Kong": [], US: [] };
      for (const item of this.subscriptions) {
        groups[item.market]?.push(item);
      }
      return groups;
    },
    publishedPlugins() {
      return this.plugins.filter((plugin) => plugin.status === "published");
    },
  },
  watch: {
    "$route.path": {
      immediate: true,
      async handler() {
        await this.activateModule(this.$route.meta.module ?? "dashboard");
      },
    },
  },
  async mounted() {
    if (this.token) {
      try {
        await this.bootstrap();
      } catch {
        this.logout();
      }
    }
  },
  beforeUnmount() {
    disposeDashboardCharts();
    disposeBacktestCharts();
  },
  methods: {
    async bootstrap() {
      await this.loadMe();
      await Promise.all([
        this.loadDataSourceSettings(),
        this.loadModelSettings(),
        this.loadStrategies(),
        this.loadSubscriptions(),
        this.loadLabelStrategyTemplates(),
        this.loadLabelStrategies(),
        this.loadLabelBindings(),
        this.loadRoles(),
        this.loadSkills(),
        this.loadPlugins(),
      ]);
    },
    async api(path, options = {}) {
      const headers = {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers ?? {}),
      };
      if (this.token) headers["x-jwt-token"] = this.token;
      const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail ?? payload.message ?? "请求失败");
      return payload;
    },
    async submitAuth() {
      this.authLoading = true;
      this.error = "";
      try {
        const payload = await this.api(this.authMode === "login" ? "/auth/login" : "/auth/register", {
          method: "POST",
          body: JSON.stringify(this.auth),
        });
        this.token = payload.token;
        this.currentUser = payload.user;
        if (this.auth.rememberMe) {
          localStorage.setItem("stock-harness-token", this.token);
          sessionStorage.removeItem("stock-harness-token");
        } else {
          sessionStorage.setItem("stock-harness-token", this.token);
          localStorage.removeItem("stock-harness-token");
        }
        await this.bootstrap();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.authLoading = false;
      }
    },
    async loadMe() {
      const payload = await this.api("/auth/me");
      this.currentUser = payload.user;
    },
    logout() {
      this.token = "";
      this.currentUser = null;
      this.strategies = [];
      this.subscriptions = [];
      this.roles = [];
      this.skills = [];
      this.plugins = [];
      this.result = null;
      localStorage.removeItem("stock-harness-token");
      sessionStorage.removeItem("stock-harness-token");
    },
    async setModule(moduleName) {
      const route = moduleRoutes[moduleName] ?? moduleRoutes.dashboard;
      if (this.$route.name !== route.name) await this.$router.push({ name: route.name });
    },
    async activateModule(moduleName) {
      if (moduleName !== "dashboard") disposeDashboardCharts();
      if (moduleName !== "backtest") disposeBacktestCharts();
      this.activeModule = moduleName;
      this.error = "";
      this.settingsMessage = "";
      if (moduleName === "dashboard") {
        await nextTick();
        this.renderDashboardCharts();
      } else if (moduleName === "backtest" && this.result) {
        await nextTick();
        this.renderBacktestCharts();
      }
    },
    async loadDataSourceSettings() {
      this.dataSourceSettings = await this.api("/settings/data-source");
    },
    async loadModelSettings() {
      this.modelConfigs = await this.api("/settings/models");
      this.modelSettings = this.modelConfigs.find((item) => item.isDefault) ?? this.modelConfigs[0] ?? await this.api("/settings/model");
      this.chatForm.modelConfigId ||= this.modelSettings.id || "";
      this.taskForm.modelConfigId ||= this.modelSettings.id || "";
      if (!this.chatForm.model) this.chatForm.model = this.modelSettings.model;
      await this.loadAvailableModels();
    },
    async loadAvailableModels() {
      try {
        const payload = await this.api("/settings/model/available");
        const models = Array.isArray(payload.models) ? payload.models : [];
        this.availableModels = [...new Set([this.modelSettings.model, this.chatForm.model, ...models].filter(Boolean))];
      } catch {
        this.availableModels = [this.modelSettings.model].filter(Boolean);
      }
    },
    async saveDataSourceSettings() {
      this.settingsSaving = true;
      this.settingsMessage = "";
      this.error = "";
      try {
        this.dataSourceSettings = await this.api("/settings/data-source", {
          method: "PUT",
          body: JSON.stringify(this.dataSourceSettings),
        });
        this.settingsMessage = "数据源配置已保存，平台接口已切换。";
        await this.refreshDashboardCharts();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.settingsSaving = false;
      }
    },
    async loadStrategies() {
      this.strategies = await this.api("/strategies");
      this.applyStrategyDefaults();
    },
    async loadSubscriptions() {
      this.subscriptions = await this.api("/subscriptions");
      await this.refreshDashboardCharts();
    },
    async saveModelSettings() {
      this.settingsSaving = true;
      this.settingsMessage = "";
      this.error = "";
      try {
        this.modelSettings = await this.api(this.modelSettings.id ? `/settings/models/${this.modelSettings.id}` : "/settings/models", {
          method: this.modelSettings.id ? "PUT" : "POST",
          body: JSON.stringify(this.modelSettings),
        });
        await this.loadModelSettings();
        this.chatForm.modelConfigId = this.modelSettings.id;
        this.chatForm.model = this.modelSettings.model;
        await this.loadAvailableModels();
        this.settingsMessage = "模型配置已保存。";
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.settingsSaving = false;
      }
    },
    newModelConfig() {
      this.modelSettings = { id: null, name: "", provider: "openai", model: "glm-4.5", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKeyRef: "ZHIPU_API_KEY", temperature: 0.2, maxOutputTokens: 4096, contextBudgetTokens: 32768, reasoningEffort: "medium", isDefault: !this.modelConfigs.length };
    },
    editModelConfig(config) { this.modelSettings = { ...config }; },
    async deleteModelConfig(config) {
      if (!confirm(`删除模型配置“${config.name}”？`)) return;
      await this.api(`/settings/models/${config.id}`, { method: "DELETE" });
      await this.loadModelSettings();
    },
    selectChatModelConfig() {
      const config = this.modelConfigs.find((item) => item.id === Number(this.chatForm.modelConfigId));
      if (config) this.chatForm.model = config.model;
    },
    async testModelConnection() {
      this.settingsSaving = true;
      this.settingsMessage = "";
      this.error = "";
      try {
        const payload = await this.api("/settings/models/test-connection", {
          method: "POST",
          body: JSON.stringify(this.modelSettings),
        });
        this.settingsMessage = payload.message ?? "模型连接测试完成。";
        await this.loadModelSettings();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.settingsSaving = false;
      }
    },
    async loadLabelStrategies() {
      this.labelStrategies = await this.api("/label-strategies");
      if (!this.bindingForm.strategyId && this.labelStrategies.length) {
        this.bindingForm.strategyId = this.labelStrategies[0].id;
      }
    },
    async loadLabelStrategyTemplates() {
      this.labelStrategyTemplates = await this.api("/label-strategies/templates");
    },
    async loadLabelBindings() {
      this.labelBindings = await this.api("/label-strategies/bindings");
      this.subscriptionLabels = await this.api("/label-strategies/labels");
    },
    addStrategyCondition() {
      this.strategyForm.conditions.push({ metric: "pe", op: "<=", value: 20 });
    },
    removeStrategyCondition(index) {
      if (this.strategyForm.conditions.length <= 1) return;
      this.strategyForm.conditions.splice(index, 1);
    },
    resetStrategyForm() {
      this.strategyForm = {
        name: "",
        targetLabel: "",
        conditions: [{ metric: "roe", op: ">=", value: 0.15 }],
      };
    },
    openStrategyModal() {
      this.resetStrategyForm();
      this.isStrategyModalOpen = true;
    },
    closeStrategyModal() {
      this.isStrategyModalOpen = false;
    },
    async saveLabelStrategy() {
      this.error = "";
      try {
        await this.api("/label-strategies", { method: "POST", body: JSON.stringify(this.strategyForm) });
        this.resetStrategyForm();
        this.closeStrategyModal();
        await this.loadLabelStrategies();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    useLabelStrategyTemplate(template) {
      this.strategyForm = {
        name: template.name,
        targetLabel: template.targetLabel,
        conditions: template.conditions.map((condition) => ({ ...condition })),
      };
      this.isStrategyModalOpen = true;
    },
    async copyLabelStrategyTemplate(key) {
      this.error = "";
      try {
        await this.api(`/label-strategies/templates/${key}/copy`, { method: "POST" });
        await this.loadLabelStrategies();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async removeLabelStrategy(id) {
      this.error = "";
      try {
        await this.api(`/label-strategies/${id}`, { method: "DELETE" });
        await Promise.all([this.loadLabelStrategies(), this.loadLabelBindings()]);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async bindLabelStrategy() {
      this.error = "";
      try {
        const multiplier = this.bindingPeriodUnit === "hours" ? 60 : 1;
        const periodMinutes = Number(this.bindingPeriodValue) * multiplier;
        await this.api("/label-strategies/bindings", {
          method: "POST",
          body: JSON.stringify({ ...this.bindingForm, periodMinutes }),
        });
        await this.loadLabelBindings();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async runLabelBinding(id) {
      this.error = "";
      try {
        await this.api(`/label-strategies/bindings/${id}/run`, { method: "POST" });
        await this.loadLabelBindings();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async runLabelStrategy(strategy) {
      if (this.labelStrategyRunId) return;
      this.labelStrategyRunId = strategy.id;
      this.labelStrategyMessage = "";
      this.error = "";
      try {
        const payload = await this.api(`/label-strategies/${strategy.id}/run`, { method: "POST" });
        await this.loadLabelBindings();
        this.labelStrategyMessage = payload.executed
          ? `${strategy.name} 已执行：检查 ${payload.executed} 家绑定公司，命中并更新标签 ${payload.hit} 家。`
          : `${strategy.name} 尚未绑定股票，请先在右侧完成绑定。`;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.labelStrategyRunId = null;
      }
    },
    strategyBindingCount(strategyId) {
      return this.labelBindings.filter((binding) => binding.strategyId === strategyId).length;
    },
    async removeLabelBinding(id) {
      this.error = "";
      try {
        await this.api(`/label-strategies/bindings/${id}`, { method: "DELETE" });
        await this.loadLabelBindings();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async lookupSymbol() {
      if (!this.subscriptionForm.symbol.trim()) return;
      this.lookupLoading = true;
      this.error = "";
      try {
        const payload = await this.api("/symbols/lookup", {
          method: "POST",
          body: JSON.stringify({ market: this.subscriptionForm.market, keyword: this.subscriptionForm.symbol, limit: 8 }),
        });
        this.symbolSuggestions = payload.symbols ?? [];
        if (this.symbolSuggestions.length === 1) this.selectSymbol(this.symbolSuggestions[0]);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.lookupLoading = false;
      }
    },
    selectSymbol(item) {
      this.subscriptionForm.market = item.market;
      this.subscriptionForm.symbol = item.symbol;
      this.subscriptionForm.stockName = item.name;
      this.symbolSuggestions = [];
    },
    clearSelectedSymbolName() {
      this.subscriptionForm.stockName = "";
      this.symbolSuggestions = [];
    },
    changeSubscriptionMarket() {
      this.subscriptionForm.symbol = "";
      this.subscriptionForm.stockName = "";
      this.symbolSuggestions = [];
    },
    async addSubscription() {
      this.error = "";
      try {
        await this.api("/subscriptions", { method: "POST", body: JSON.stringify(this.subscriptionForm) });
        this.subscriptionForm.remark = "";
        await this.loadSubscriptions();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async removeSubscription(id) {
      this.error = "";
      try {
        await this.api(`/subscriptions/${id}`, { method: "DELETE" });
        disposeDashboardChart(id);
        this.subscriptions = this.subscriptions.filter((item) => item.id !== id);
        this.chartData = Object.fromEntries(Object.entries(this.chartData).filter(([key]) => Number(key) !== id));
        this.chartErrors = Object.fromEntries(Object.entries(this.chartErrors).filter(([key]) => Number(key) !== id));
        this.fundamentalData = Object.fromEntries(Object.entries(this.fundamentalData).filter(([key]) => Number(key) !== id));
        this.fundamentalErrors = Object.fromEntries(Object.entries(this.fundamentalErrors).filter(([key]) => Number(key) !== id));
        await nextTick();
        await this.refreshDashboardCharts();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async refreshDashboardCharts() {
      this.chartErrors = {};
      this.fundamentalErrors = {};
      if (!this.subscriptions.length) {
        disposeDashboardCharts();
        this.chartData = {};
        this.fundamentalData = {};
        return;
      }
      this.dashboardLoading = true;
      const nextData = {};
      const nextErrors = {};
      const nextFundamentals = {};
      const nextFundamentalErrors = {};
      await Promise.all(
        this.subscriptions.map(async (item) => {
          await Promise.all([
            (async () => {
              try {
                const payload = await this.api("/bars", {
                  method: "POST",
                  body: JSON.stringify({
                    market: item.market,
                    symbol: item.symbol,
                    start: startForRange(this.selectedRange),
                    end: isoDate(),
                    adjust: "qfq",
                    interval: this.selectedInterval,
                  }),
                });
                nextData[item.id] = payload.bars;
              } catch (error) {
                nextErrors[item.id] = error instanceof Error ? error.message : String(error);
              }
            })(),
            (async () => {
              try {
                nextFundamentals[item.id] = await this.api("/fundamentals", {
                  method: "POST",
                  body: JSON.stringify({ market: item.market, symbol: item.symbol }),
                });
              } catch (error) {
                nextFundamentalErrors[item.id] = error instanceof Error ? error.message : String(error);
              }
            })(),
          ]);
        }),
      );
      this.chartData = nextData;
      this.chartErrors = nextErrors;
      this.fundamentalData = nextFundamentals;
      this.fundamentalErrors = nextFundamentalErrors;
      this.dashboardLoading = false;
      await nextTick();
      this.renderDashboardCharts();
    },
    renderDashboardCharts() {
      const activeIds = new Set(this.subscriptions.map((item) => item.id));
      for (const id of dashboardCharts.keys()) {
        if (!activeIds.has(id)) disposeDashboardChart(id);
      }
      for (const item of this.subscriptions) {
        const bars = this.chartData[item.id] ?? [];
        const chartId = `subChart-${item.id}`;
        const node = document.getElementById(chartId);
        if (!node || !bars.length) continue;
        disposeDashboardChart(item.id);
        const chart = init(node, { locale: this.chartLocale, timezone: "Asia/Shanghai" });
        if (!chart) continue;
        const data = bars.map((row) => ({
          timestamp: new Date(row.date).getTime(),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume ?? 0),
        }));
        chart.setPriceVolumePrecision(2, 0);
        chart.applyNewData(data);
        const resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(node);
        dashboardCharts.set(item.id, { chart, resizeObserver });
      }
    },
    async loadRoles() {
      this.roles = await this.api("/agent-roles");
    },
    saveTask() {
      if (!this.taskForm.name || !this.taskForm.prompt || !this.taskForm.modelConfigId) { this.error = "请填写任务名称、提示词并选择执行模型。"; return; }
      const model = this.modelConfigs.find((item) => item.id === Number(this.taskForm.modelConfigId));
      const task = { ...this.taskForm, id: Date.now(), modelName: model?.name ?? model?.model ?? "" };
      this.savedTasks.unshift(task);
      localStorage.setItem("stock-harness-pi-tasks", JSON.stringify(this.savedTasks));
      this.settingsMessage = `任务“${task.name}”已保存。`;
    },
    deleteTask(id) {
      this.savedTasks = this.savedTasks.filter((item) => item.id !== id);
      localStorage.setItem("stock-harness-pi-tasks", JSON.stringify(this.savedTasks));
    },
    newChatSession() {
      this.archiveCurrentChat();
      this.chatSessionId = null;
      this.chatMessages = [];
      this.chatReply = "";
      this.chatThinking = "";
      this.chatTrace = null;
      this.error = "";
    },
    archiveCurrentChat() {
      if (!this.chatMessages.length) return;
      const first = this.chatMessages.find((item) => item.role === "user")?.content || "新对话";
      const entry = {
        id: this.chatSessionId || Date.now(),
        title: first.slice(0, 28),
        updatedAt: new Date().toISOString(),
        messages: this.chatMessages,
      };
      this.chatHistory = [entry, ...this.chatHistory.filter((item) => item.id !== entry.id)].slice(0, 30);
      localStorage.setItem("stock-harness-chat-history", JSON.stringify(this.chatHistory));
    },
    openChatHistory(entry) {
      this.archiveCurrentChat();
      this.chatSessionId = entry.id;
      this.chatMessages = entry.messages || [];
      this.chatReply = "";
      this.chatThinking = "";
    },
    filteredChatHistory() {
      const query = this.chatHistoryQuery.trim().toLowerCase();
      return query ? this.chatHistory.filter((item) => item.title.toLowerCase().includes(query)) : this.chatHistory;
    },
    async startChat() {
      if (!this.chatForm.message.trim() || this.chatLoading) return;
      this.chatLoading = true;
      this.chatReply = "";
      this.chatThinking = "";
      this.chatTrace = null;
      this.error = "";
      const userMessage = this.chatForm.message.trim();
      const selectedModel = this.chatForm.model || this.modelSettings.model;
      const selectedConfig = this.modelConfigs.find((item) => item.id === Number(this.chatForm.modelConfigId)) ?? this.modelSettings;
      this.chatMessages.push({ role: "user", content: userMessage, roleName: this.chatRoleLabel() });
      try {
        await configurePiRuntimeClient({ ...selectedConfig, model: selectedModel });
        const result = await llmClient.stream(
          {
            messages: [{ role: "user", content: userMessage }],
            sessionId: this.chatSessionId,
            roleId: this.chatForm.roleId ? Number(this.chatForm.roleId) : null,
            jwtToken: this.token,
            model: selectedModel,
            modelConfigId: selectedConfig.id,
            temperature: this.modelSettings.temperature,
            maxTokens: this.modelSettings.maxOutputTokens,
          },
          (chunk) => {
            if (chunk.meta) {
              this.chatTrace = chunk.meta;
              this.chatSessionId = chunk.meta.sessionId ?? chunk.meta.conversationId;
            }
            this.chatReply = chunk.fullContent ?? this.chatReply;
            this.chatThinking = chunk.fullThinking ?? this.chatThinking;
          },
        );
        const assistantContent = result.content || this.chatReply;
        const assistantThinking = result.thinking || this.chatThinking;
        if (assistantContent || assistantThinking) {
          this.chatMessages.push({ role: "assistant", content: assistantContent, thinking: assistantThinking, roleName: this.chatTrace?.role ?? "个人助手" });
        }
        this.chatReply = "";
        this.chatThinking = "";
        this.setComposerText("");
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.chatMessages = this.chatMessages.filter((item) => item.content !== userMessage || item.role !== "user");
      } finally {
        this.chatLoading = false;
      }
    },
    consumeChatEvent(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === "meta") {
        this.chatTrace = event;
        this.chatSessionId = event.sessionId ?? event.conversationId;
      }
      if (event.type === "delta") this.chatReply += event.content ?? "";
      if (event.type === "thinking") this.chatThinking += event.content ?? "";
      if (event.type === "error") throw new Error(event.message ?? "Pi Runtime 对话失败");
    },
    chatRoleLabel() {
      const role = this.roles.find((item) => item.id === Number(this.chatForm.roleId));
      return role?.name ?? "个人";
    },
    insertRoleMention(role) {
      const mention = `@${role.name} `;
      if (!this.chatForm.message.includes(mention)) {
        this.setComposerText(`${mention}${this.chatForm.message}`.trimStart());
      }
    },
    insertStockMention(stock) {
      const label = `#${stock.symbol}${stock.stockName ? `(${stock.stockName})` : ""} `;
      this.setComposerText(`${this.chatForm.message}${this.chatForm.message ? " " : ""}${label}`);
    },
    useChatStarter(starter) {
      this.setComposerText(starter.prompt);
    },
    syncComposer(event) {
      this.chatForm.message = event.currentTarget.innerText.replace(/\u00a0/g, " ").trim();
    },
    setComposerText(value) {
      this.chatForm.message = value;
      nextTick(() => {
        const editor = this.$refs.chatComposer;
        if (!editor) return;
        editor.innerText = value;
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
    },
    messageParts(content) {
      const visible = this.messageView(content).content;
      const parts = [];
      const pattern = /```pi-plugin\s*([\s\S]*?)```/g;
      let lastIndex = 0;
      for (const match of visible.matchAll(pattern)) {
        if (match.index > lastIndex) parts.push({ type: "markdown", html: this.renderMarkdown(visible.slice(lastIndex, match.index)) });
        parts.push({ type: "plugin", plugin: this.parsePluginBlock(match[1]) });
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < visible.length) parts.push({ type: "markdown", html: this.renderMarkdown(visible.slice(lastIndex)) });
      return parts.length ? parts : [{ type: "markdown", html: this.renderMarkdown(visible) }];
    },
    messageView(content = "", explicitThinking = "") {
      let visible = String(content || "");
      const thoughts = [];
      const thinkPattern = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
      visible = visible.replace(thinkPattern, (_, thought) => {
        if (thought?.trim()) thoughts.push(thought.trim());
        return "";
      });
      const thinking = [explicitThinking, ...thoughts].filter(Boolean).join("\n\n").trim();
      return { content: visible.trim(), thinking };
    },
    thinkingText(content = "", explicitThinking = "") {
      return this.messageView(content, explicitThinking).thinking;
    },
    thinkingHtml(content = "", explicitThinking = "") {
      return this.renderMarkdown(this.thinkingText(content, explicitThinking));
    },
    renderMarkdown(content) {
      return markdown.render(content || "");
    },
    parsePluginBlock(raw) {
      try {
        const value = JSON.parse(raw.trim());
        return { kind: value.kind ?? "json", title: value.title ?? "插件结果", data: value.data ?? value };
      } catch {
        return { kind: "json", title: "插件结果", data: raw.trim() };
      }
    },
    routeLabel(route) {
      return { mentioned: "@指定", selected: "手动选择", auto: "自动分配", personal: "个人助手" }[route] ?? route ?? "";
    },
    async addRole() {
      this.error = "";
      try {
        await this.api("/agent-roles", { method: "POST", body: JSON.stringify(this.roleForm) });
        this.roleForm = { name: "", responsibility: "", systemPrompt: "" };
        await this.loadRoles();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async removeRole(id) {
      await this.api(`/agent-roles/${id}`, { method: "DELETE" });
      await this.loadRoles();
    },
    async saveRoleCapabilities(role) {
      this.error = "";
      try {
        await this.api(`/agent-roles/${role.id}/capabilities`, {
          method: "PUT",
          body: JSON.stringify({ skillIds: role.skillIds ?? [], pluginIds: role.pluginIds ?? [] }),
        });
        await this.loadRoles();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    toggleRoleId(list, id) {
      const numericId = Number(id);
      const index = list.indexOf(numericId);
      if (index >= 0) list.splice(index, 1);
      else list.push(numericId);
    },
    roleSkillNames(role) {
      const ids = role.skillIds ?? [];
      return this.skills.filter((skill) => ids.includes(skill.id)).map((skill) => skill.name).join("、") || "未选择";
    },
    rolePluginNames(role) {
      const ids = role.pluginIds ?? [];
      return this.plugins.filter((plugin) => ids.includes(plugin.id)).map((plugin) => plugin.name).join("、") || "未选择";
    },
    async loadSkills() {
      this.skills = await this.api("/pi/skills");
    },
    async importSkillZip(event) {
      await this.importPackage(event, "skill", "zip");
    },
    async importSkillFolder(event) {
      await this.importPackage(event, "skill", "folder");
    },
    async importPluginZip(event) {
      await this.importPackage(event, "plugin", "zip");
    },
    async importPluginFolder(event) {
      await this.importPackage(event, "plugin", "folder");
    },
    async importPackage(event, target, type) {
      this.error = "";
      try {
        const files = Array.from(event.target.files ?? []);
        if (!files.length) return;
        const packageFiles = await Promise.all(files.map((file) => this.readPackageFile(file, type)));
        const packagePayload = {
          type,
          name: type === "zip" ? files[0].name : this.folderPackageName(files),
          files: packageFiles,
        };
        const summary = `${packagePayload.name} · ${packageFiles.length} 个文件`;
        if (target === "skill") {
          this.skillForm.package = packagePayload;
          this.skillUploadSummary = summary;
          this.skillForm.content ||= this.pickImportedText(packageFiles, ["SKILL.md", "README.md", ".md", ".txt"]);
          this.skillForm.name ||= this.nameFromPackage(packagePayload.name, "Skill");
          this.skillForm.description ||= `从 ${type === "zip" ? "ZIP" : "文件夹"} 导入`;
        } else {
          this.pluginForm.package = packagePayload;
          this.pluginUploadSummary = summary;
          const importedCode = this.pickImportedText(packageFiles, ["plugin.js", "index.js", "main.js", ".js", ".ts"]);
          if (!this.pluginForm.code || this.pluginForm.code === defaultPluginCode) this.pluginForm.code = importedCode || this.pluginForm.code;
          this.pluginForm.name ||= this.nameFromPackage(packagePayload.name, "插件");
          this.pluginForm.description ||= `从 ${type === "zip" ? "ZIP" : "文件夹"} 导入`;
          this.pluginForm.sourceUrl ||= `local://${type}/${packagePayload.name}`;
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        event.target.value = "";
      }
    },
    async readPackageFile(file, type) {
      const path = type === "folder" ? file.webkitRelativePath || file.name : file.name;
      const encoding = type === "zip" || !this.isTextFile(path) ? "base64" : "utf8";
      const content = encoding === "base64" ? await this.readFileAsBase64(file) : await file.text();
      return { path, content, encoding, size: file.size };
    },
    readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
        reader.readAsDataURL(file);
      });
    },
    isTextFile(path) {
      return /\.(md|txt|json|js|ts|tsx|jsx|py|yml|yaml|toml|ini|css|html|xml|csv|sql|sh|ps1)$/i.test(path);
    },
    pickImportedText(files, preferredNames) {
      const textFiles = files.filter((file) => file.encoding === "utf8");
      for (const preferredName of preferredNames) {
        const match = textFiles.find((file) => file.path.toLowerCase().endsWith(preferredName.toLowerCase()));
        if (match) return match.content;
      }
      return textFiles[0]?.content ?? "";
    },
    folderPackageName(files) {
      const firstPath = files[0]?.webkitRelativePath || files[0]?.name || "package";
      return firstPath.split(/[\\/]/)[0] || "package";
    },
    nameFromPackage(name, fallback) {
      return String(name ?? fallback).replace(/\.zip$/i, "").replace(/[-_]+/g, " ").trim() || fallback;
    },
    async addSkill() {
      this.error = "";
      try {
        await this.api("/pi/skills", { method: "POST", body: JSON.stringify(this.skillForm) });
        this.skillForm = { name: "", description: "", content: "", package: null };
        this.skillUploadSummary = "";
        await this.loadSkills();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async removeSkill(id) {
      await this.api(`/pi/skills/${id}`, { method: "DELETE" });
      await Promise.all([this.loadSkills(), this.loadRoles()]);
    },
    async loadPlugins() {
      this.plugins = await this.api("/pi/plugins");
    },
    editPlugin(plugin) {
      this.pluginForm = { id: plugin.id, name: plugin.name, description: plugin.description, sourceUrl: plugin.sourceUrl ?? "", code: plugin.code, package: null };
      this.pluginUploadSummary = plugin.packageName ? `${plugin.packageName} · 已导入` : "";
    },
    resetPluginForm() {
      this.pluginForm = { id: null, name: "", description: "", sourceUrl: "", code: defaultPluginCode, package: null };
      this.pluginUploadSummary = "";
    },
    async savePlugin() {
      this.error = "";
      try {
        const id = this.pluginForm.id;
        await this.api(id ? `/pi/plugins/${id}` : "/pi/plugins", {
          method: id ? "PUT" : "POST",
          body: JSON.stringify(this.pluginForm),
        });
        this.resetPluginForm();
        await this.loadPlugins();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async publishPlugin(id) {
      await this.api(`/pi/plugins/${id}/publish`, { method: "POST" });
      await this.loadPlugins();
    },
    async offlinePlugin(id) {
      await this.api(`/pi/plugins/${id}/offline`, { method: "POST" });
      await this.loadPlugins();
    },
    async removePlugin(id) {
      await this.api(`/pi/plugins/${id}`, { method: "DELETE" });
      await Promise.all([this.loadPlugins(), this.loadRoles()]);
    },
    importPluginFromTemplate() {
      this.pluginForm = {
        id: null,
        name: "行情摘要插件",
        description: "读取上下文里的行情与订阅列表，输出结构化摘要。",
        sourceUrl: "local://template/market-summary",
        code: defaultPluginCode,
        package: null,
      };
      this.pluginUploadSummary = "";
    },
    applyDefaultSymbol() {
      this.form.symbol = { "A Share": "600519", "Hong Kong": "00700", US: "AAPL" }[this.form.market];
    },
    applyStrategyDefaults() {
      const selected = this.strategies.find((item) => item.key === this.form.strategy);
      if (selected) this.form.strategy_params = { ...selected.default_params };
    },
    openBacktestStrategyEditor(strategy = null) {
      this.backtestStrategyForm = strategy ? {
        id: strategy.id,
        name: strategy.name,
        description: strategy.description || "",
        definitionText: JSON.stringify(strategy.definition, null, 2),
      } : {
        id: null,
        name: "新回测策略",
        description: "由 JSON 规则驱动的回测策略。",
        definitionText: JSON.stringify({
          indicators: { fast: { type: "sma", period: 10 }, slow: { type: "sma", period: 30 } },
          entry: { all: [{ left: "fast", op: "crosses_above", right: "slow" }] },
          exit: { all: [{ left: "fast", op: "crosses_below", right: "slow" }] },
          risk: { stop_loss_pct: 0.08 },
        }, null, 2),
      };
      this.showBacktestStrategyEditor = true;
    },
    editSelectedBacktestStrategy() {
      const selected = this.strategies.find((item) => item.key === this.form.strategy);
      if (selected?.source === "custom") this.openBacktestStrategyEditor(selected);
    },
    async saveBacktestStrategy() {
      this.error = "";
      try {
        const definition = JSON.parse(this.backtestStrategyForm.definitionText);
        const id = this.backtestStrategyForm.id;
        const saved = await this.api(id ? `/backtest-strategies/${id}` : "/backtest-strategies", {
          method: id ? "PUT" : "POST",
          body: JSON.stringify({
            name: this.backtestStrategyForm.name,
            description: this.backtestStrategyForm.description,
            definition,
          }),
        });
        await this.loadStrategies();
        this.form.strategy = saved.key;
        this.applyStrategyDefaults();
        this.showBacktestStrategyEditor = false;
      } catch (error) {
        this.error = error instanceof SyntaxError ? `策略 JSON 格式错误：${error.message}` : error instanceof Error ? error.message : String(error);
      }
    },
    async removeSelectedBacktestStrategy() {
      const selected = this.strategies.find((item) => item.key === this.form.strategy);
      if (selected?.source !== "custom" || !window.confirm(`确认删除策略“${selected.name}”？`)) return;
      await this.api(`/backtest-strategies/${selected.id}`, { method: "DELETE" });
      this.form.strategy = "ma_cross";
      await this.loadStrategies();
    },
    setBacktestRange(range) {
      const end = new Date();
      const start = new Date(end);
      if (range === "ytd") {
        start.setMonth(0, 1);
      } else if (range === "6m") {
        start.setMonth(start.getMonth() - 6);
      } else {
        start.setFullYear(start.getFullYear() - Number(range));
      }
      this.form.start = dateInputValue(start);
      this.form.end = dateInputValue(end);
    },
    strategyLabel(key, fallback) {
      return strategyLabels[key] ?? fallback ?? key;
    },
    paramLabel(key) {
      return paramLabels[key] ?? key;
    },
    marketLabel(key) {
      return marketLabels[key] ?? key;
    },
    metricLabel(key) {
      return fundamentalMetricLabels[key] ?? key;
    },
    dataSourceLabel(value) {
      return value === "futu" ? "Futu OpenD" : "自动数据源（AkShare/Yahoo）";
    },
    rangeLabel(range) {
      return { day: "当日", week: "本周", month: "本月" }[range] ?? range;
    },
    intervalLabel(interval) {
      return { "1m": "1 分钟", "15m": "15 分钟", "30m": "30 分钟", "1h": "1 小时", "4h": "4 小时", "1d": "日线" }[interval] ?? interval;
    },
    pluginStatusLabel(status) {
      return { draft: "草稿", published: "已发布", offline: "已下线" }[status] ?? status;
    },
    sourceTypeLabel(sourceType) {
      return { manual: "手动", folder: "文件夹", zip: "ZIP" }[sourceType] ?? "手动";
    },
    formatTime(value) {
      if (!value) return "";
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    },
    pct(value) {
      return `${(Number(value ?? 0) * 100).toFixed(2)}%`;
    },
    judgementClass(itemId) {
      const tone = this.fundamentalData[itemId]?.ai_judgement?.tone ?? "neutral";
      return `tone-${tone}`;
    },
    labelsForSubscription(id) {
      return this.subscriptionLabels[String(id)] ?? [];
    },
    mergedLabelsForSubscription(id) {
      const groups = new Map();
      for (const label of this.labelsForSubscription(id)) {
        const key = label.latestLabel;
        if (!key) continue;
        if (!groups.has(key)) {
          groups.set(key, { label: key, strategies: [], reasons: [], ids: [] });
        }
        const group = groups.get(key);
        group.strategies.push(label.strategyName || `策略 #${label.strategyId}`);
        group.reasons.push(label.latestReason || "无命中说明");
        group.ids.push(label.id);
      }
      return Array.from(groups.values()).map((group) => ({
        ...group,
        key: `${group.label}-${group.ids.join("-")}`,
        title: group.strategies.map((name, index) => `${name}: ${group.reasons[index]}`).join("\n"),
      }));
    },
    bindingSubscriptionName(binding) {
      return `${binding.symbol} ${binding.stockName || this.marketLabel(binding.market)}`;
    },
    async runBacktest() {
      this.loading = true;
      this.error = "";
      try {
        this.result = await this.api("/backtest", { method: "POST", body: JSON.stringify(this.form) });
        await nextTick();
        this.renderBacktestCharts();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    renderBacktestCharts() {
      if (!this.result) return;
      disposeBacktestCharts();

      const equityChart = createBacktestChart(
        document.getElementById("equityChart"),
        (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value),
      );
      const strategySeries = equityChart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 2, title: "策略" });
      strategySeries.setData(this.result.equity.map((row) => ({ time: row.date, value: row.value })));
      const benchmarkSeries = equityChart.addSeries(LineSeries, { color: "#f97316", lineWidth: 2, title: "买入持有" });
      benchmarkSeries.setData(this.result.benchmark_equity.map((row) => ({ time: row.date, value: row.value })));
      equityChart.timeScale().fitContent();

      const drawdownChart = createBacktestChart(document.getElementById("drawdownChart"), (value) => `${value.toFixed(1)}%`);
      const drawdownSeries = drawdownChart.addSeries(AreaSeries, {
        lineColor: "#dc2626",
        topColor: "rgba(220, 38, 38, 0.08)",
        bottomColor: "rgba(220, 38, 38, 0.32)",
        lineWidth: 2,
        title: "回撤",
      });
      drawdownSeries.setData(this.result.drawdown.map((row) => ({ time: row.date, value: row.value * 100 })));
      drawdownChart.timeScale().fitContent();
    },
  },
  template: `
    <div v-if="!token" class="auth-screen">
      <form class="auth-card" @submit.prevent="submitAuth">
        <h1>stock-harness</h1>
        <p>登录后访问本地量化助手。</p>
        <label>用户名<input v-model.trim="auth.username" autocomplete="username" /></label>
        <label>密码<input v-model="auth.password" type="password" autocomplete="current-password" /></label>
        <label class="checkbox-row">
          <input type="checkbox" v-model="auth.rememberMe" />
          <span>记住登录状态，30 天内自动登录</span>
        </label>
        <button :disabled="authLoading">{{ authLoading ? "处理中..." : (authMode === "login" ? "登录" : "注册") }}</button>
        <button class="ghost" type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'">
          {{ authMode === "login" ? "没有账号？去注册" : "已有账号？去登录" }}
        </button>
        <div v-if="error" class="error">{{ error }}</div>
      </form>
    </div>

    <div v-else id="layout">
      <aside>
        <h1>stock-harness</h1>
        <div class="user-row">
          <span>{{ currentUser?.username }}</span>
          <button class="small" @click="logout">退出</button>
        </div>

        <nav class="module-nav">
          <div class="nav-group">
            <h2>量化工作台</h2>
            <button :class="{ active: activeModule === 'dashboard' }" @click="setModule('dashboard')">Dashboard</button>
            <button :class="{ active: activeModule === 'label-strategies' }" @click="setModule('label-strategies')">标签策略</button>
            <button :class="{ active: activeModule === 'backtest' }" @click="setModule('backtest')">回测策略</button>
          </div>
          <div class="nav-group">
            <h2>Pi Runtime</h2>
            <button :class="{ active: activeModule === 'pi-chat' }" @click="setModule('pi-chat')">新对话</button>
            <button :class="{ active: activeModule === 'pi-tasks' }" @click="setModule('pi-tasks')">任务管理</button>
            <button :class="{ active: activeModule === 'pi-roles' }" @click="setModule('pi-roles')">角色管理</button>
            <button :class="{ active: activeModule === 'pi-skills' }" @click="setModule('pi-skills')">Skill 管理</button>
            <button :class="{ active: activeModule === 'pi-plugins' }" @click="setModule('pi-plugins')">插件管理</button>
          </div>
          <div class="nav-group">
            <h2>系统</h2>
            <button :class="{ active: activeModule === 'settings' }" @click="setModule('settings')">系统管理</button>
          </div>
        </nav>
      </aside>

      <main :class="{ 'chat-main': activeModule === 'pi-chat' }">
        <header>
          <h1>本地量化助手</h1>
          <p>Pi Runtime -> Node API -> Python Backtrader Core</p>
        </header>
        <div v-if="error" class="error">{{ error }}</div>

        <section v-if="activeModule === 'dashboard'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>Dashboard</h2>
              <p>订阅股票，分别选择时间范围和 K 线聚合周期。</p>
              <p class="hint dark">当前数据源：{{ dataSourceLabel(dataSourceSettings.dataSource) }}</p>
            </div>
            <div class="range-tabs">
              <div class="chart-control">
                <span class="chart-control-label">时间范围</span>
                <div class="chart-control-inputs">
                  <button v-for="range in ['day', 'week', 'month']" :key="range" :class="{ active: selectedRange === range }" @click="selectedRange = range; refreshDashboardCharts()">{{ rangeLabel(range) }}</button>
                </div>
              </div>
              <label class="chart-control interval-field">
                <span class="chart-control-label">K 线聚合</span>
                <select v-model="selectedInterval" @change="refreshDashboardCharts">
                  <option v-for="interval in ['1m', '15m', '30m', '1h', '4h', '1d']" :key="interval" :value="interval">{{ intervalLabel(interval) }}</option>
                </select>
              </label>
              <button type="button" class="refresh-button" :disabled="dashboardLoading" @click="refreshDashboardCharts">{{ dashboardLoading ? "刷新中" : "刷新" }}</button>
              <select v-model="chartLocale" class="chart-locale-select" @change="renderDashboardCharts">
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
          </div>

          <form class="subscription-form" @submit.prevent="lookupSymbol">
            <select v-model="subscriptionForm.market" @change="changeSubscriptionMarket">
              <option value="A Share">A 股</option>
              <option value="Hong Kong">港股</option>
              <option value="US">美股</option>
            </select>
            <div class="lookup-field">
              <input v-model.trim="subscriptionForm.symbol" @input="clearSelectedSymbolName" placeholder="股票代码，如 600519 / 00700 / AAPL" @blur="lookupSymbol" />
              <div v-if="symbolSuggestions.length" class="suggestions">
                <button v-for="item in symbolSuggestions" :key="item.market + item.symbol" type="button" @mousedown.prevent="selectSymbol(item)">
                  <strong>{{ item.symbol }}</strong>
                  <span>{{ item.name }}</span>
                  <small>{{ marketLabel(item.market) }} · {{ item.source }}</small>
                </button>
              </div>
            </div>
            <input v-model.trim="subscriptionForm.stockName" readonly placeholder="股票名称" />
            <input v-model.trim="subscriptionForm.remark" placeholder="备注，可选" />
            <button type="button" :disabled="lookupLoading" @click="addSubscription">{{ lookupLoading ? "查询中..." : "订阅" }}</button>
          </form>

          <div v-if="dashboardLoading" class="hint dark">正在加载 K 线...</div>
          <div v-if="!subscriptions.length" class="empty-state">还没有订阅股票。</div>

          <section v-for="(items, market) in groupedSubscriptions" :key="market" v-show="items.length" class="market-section">
            <h3>{{ marketLabel(market) }}</h3>
            <div class="subscription-grid">
              <article v-for="item in items" :key="item.id" class="subscription-card">
                <div class="card-title">
                  <div>
                    <strong>#{{ item.id }} {{ item.symbol }}</strong>
                    <span>{{ item.stockName || item.name || marketLabel(item.market) }}</span>
                  </div>
                  <button class="small danger" type="button" @click="removeSubscription(item.id)">删除</button>
                </div>
                <div class="subscription-meta">
                  <span>订阅人：{{ item.subscribedBy || currentUser?.username }}</span>
                  <span>订阅时间：{{ formatTime(item.createdAt) }}</span>
                  <span v-if="item.remark">备注：{{ item.remark }}</span>
                </div>
                <div v-if="mergedLabelsForSubscription(item.id).length" class="strategy-label-row">
                  <span v-for="label in mergedLabelsForSubscription(item.id)" :key="label.key" class="strategy-label" :title="label.title">
                    {{ label.label }}
                    <small>{{ label.strategies.length }} 个策略</small>
                    <span class="strategy-label-tooltip">
                      <strong>{{ label.label }}</strong>
                      <em v-for="(strategy, index) in label.strategies" :key="strategy + index">
                        {{ strategy }}：{{ label.reasons[index] }}
                      </em>
                    </span>
                  </span>
                </div>
                <div v-if="fundamentalData[item.id]" class="fundamental-panel">
                  <div class="fundamental-grid">
                    <article v-for="metric in fundamentalData[item.id].metrics" :key="metric.key">
                      <span>{{ metric.label }}</span>
                      <strong>{{ metric.display }}</strong>
                    </article>
                  </div>
                  <p class="hint dark">
                    来源：{{ fundamentalData[item.id].source }} · 财报期：{{ fundamentalData[item.id].period || "未知" }} · {{ fundamentalData[item.id].note }}
                  </p>
                  <p v-if="fundamentalData[item.id].warning" class="hint dark">{{ fundamentalData[item.id].warning }}</p>
                </div>
                <div v-else-if="fundamentalErrors[item.id]" class="fundamental-error">基本面加载失败：{{ fundamentalErrors[item.id] }}</div>
                <div v-if="chartErrors[item.id]" class="chart-error">K 线加载失败：{{ chartErrors[item.id] }}</div>
                <div v-else :id="'subChart-' + item.id" class="mini-chart"></div>
              </article>
            </div>
          </section>
        </section>

        <section v-if="activeModule === 'label-strategies'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>标签策略</h2>
              <p>维护基本面标签规则，并绑定到已订阅股票定期执行。</p>
            </div>
            <button class="small" type="button" @click="openStrategyModal">新增策略</button>
          </div>

          <section class="strategy-config-panel">
            <div class="strategy-column">
              <h3>策略规则</h3>
              <div v-if="labelStrategyMessage" class="success">{{ labelStrategyMessage }}</div>
              <div class="template-list">
                <article v-for="template in labelStrategyTemplates" :key="template.key">
                  <div>
                    <strong>{{ template.name }}</strong>
                    <span>{{ template.targetLabel }}</span>
                  </div>
                  <small>{{ template.description }}</small>
                  <small>{{ template.conditions.map((c) => metricLabel(c.metric) + ' ' + c.op + ' ' + c.value).join('；') }}</small>
                  <div class="button-row">
                    <button class="small" type="button" @click="useLabelStrategyTemplate(template)">填入表单</button>
                    <button class="small" type="button" @click="copyLabelStrategyTemplate(template.key)">直接复制</button>
                  </div>
                </article>
              </div>
              <div class="strategy-list">
                <article v-for="strategy in labelStrategies" :key="strategy.id">
                  <div>
                    <strong>{{ strategy.name }}</strong>
                    <span>{{ strategy.targetLabel }}</span>
                  </div>
                  <small>{{ strategy.conditions.map((c) => metricLabel(c.metric) + ' ' + c.op + ' ' + c.value).join('；') }}</small>
                  <small>已绑定 {{ strategyBindingCount(strategy.id) }} 家公司</small>
                  <div class="button-row">
                    <button class="small" type="button" :disabled="Boolean(labelStrategyRunId)" @click="runLabelStrategy(strategy)">
                      {{ labelStrategyRunId === strategy.id ? "执行中..." : "执行策略" }}
                    </button>
                    <button class="small danger" type="button" :disabled="Boolean(labelStrategyRunId)" @click="removeLabelStrategy(strategy.id)">删除</button>
                  </div>
                </article>
              </div>
            </div>
            <div class="strategy-column">
              <h3>股票绑定</h3>
              <form class="strategy-form" @submit.prevent="bindLabelStrategy">
                <select v-model.number="bindingForm.subscriptionId">
                  <option value="">选择股票</option>
                  <option v-for="item in subscriptions" :key="item.id" :value="item.id">{{ item.symbol }} {{ item.stockName }}</option>
                </select>
                <select v-model.number="bindingForm.strategyId">
                  <option value="">选择策略</option>
                  <option v-for="strategy in labelStrategies" :key="strategy.id" :value="strategy.id">{{ strategy.name }}</option>
                </select>
                <div class="period-input-row">
                  <input type="number" :min="bindingPeriodUnit === 'hours' ? 1 : 5" step="1" v-model.number="bindingPeriodValue" aria-label="执行周期" />
                  <select v-model="bindingPeriodUnit" aria-label="执行周期单位">
                    <option value="minutes">分钟</option>
                    <option value="hours">小时</option>
                  </select>
                </div>
                <button class="small">绑定策略</button>
              </form>
              <div class="strategy-list">
                <article v-for="binding in labelBindings" :key="binding.id">
                  <div>
                    <strong>{{ bindingSubscriptionName(binding) }}</strong>
                    <span>{{ binding.strategyName }} · {{ binding.periodMinutes % 60 === 0 ? binding.periodMinutes / 60 + ' 小时' : binding.periodMinutes + ' 分钟' }}</span>
                  </div>
                  <small>{{ binding.latestLabel || "未命中" }} · {{ binding.latestReason || "等待执行" }}</small>
                  <div class="button-row">
                    <button class="small" type="button" @click="runLabelBinding(binding.id)">立即执行</button>
                    <button class="small danger" type="button" @click="removeLabelBinding(binding.id)">解绑</button>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <div v-if="isStrategyModalOpen" class="modal-backdrop" @click.self="closeStrategyModal">
            <section class="modal-panel">
              <div class="modal-head">
                <div>
                  <h3>新增策略</h3>
                  <p>设置命中标签和基本面条件。</p>
                </div>
                <button class="small ghost" type="button" @click="closeStrategyModal">关闭</button>
              </div>
              <form class="strategy-form" @submit.prevent="saveLabelStrategy">
                <label>策略名称<input v-model.trim="strategyForm.name" placeholder="如：高 ROE 现金牛" /></label>
                <label>命中标签<input v-model.trim="strategyForm.targetLabel" placeholder="如：好公司 / 贵公司" /></label>
                <div v-for="(condition, index) in strategyForm.conditions" :key="index" class="condition-row">
                  <select v-model="condition.metric">
                    <option v-for="(_, key) in fundamentalMetricLabels" :key="key" :value="key">{{ metricLabel(key) }}</option>
                  </select>
                  <select v-model="condition.op">
                    <option value=">">&gt;</option>
                    <option value=">=">&gt;=</option>
                    <option value="<">&lt;</option>
                    <option value="<=">&lt;=</option>
                    <option value="==">=</option>
                    <option value="!=">!=</option>
                  </select>
                  <input type="number" step="0.0001" v-model.number="condition.value" />
                  <button class="small danger" type="button" @click="removeStrategyCondition(index)">删除</button>
                </div>
                <div class="modal-actions">
                  <button type="button" class="small" @click="addStrategyCondition">新增条件</button>
                  <div class="button-row">
                    <button type="button" class="small ghost" @click="closeStrategyModal">取消</button>
                    <button class="small">保存策略</button>
                  </div>
                </div>
              </form>
            </section>
          </div>
        </section>

        <section v-if="activeModule === 'backtest'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>回测策略</h2>
              <p>自定义市场、标的、策略参数、资金和手续费。</p>
            </div>
          </div>
          <div class="backtest-layout">
            <form class="settings-form" @submit.prevent="runBacktest">
              <label>市场
                <select v-model="form.market" @change="applyDefaultSymbol">
                  <option value="A Share">A 股</option>
                  <option value="Hong Kong">港股</option>
                  <option value="US">美股</option>
                </select>
              </label>
              <label>股票代码<input v-model.trim="form.symbol" /></label>
              <label>开始日期<input type="date" v-model="form.start" /></label>
              <label>结束日期<input type="date" v-model="form.end" /></label>
              <div class="backtest-date-presets" aria-label="快速选择回测日期范围">
                <span>快速选择</span>
                <button type="button" class="small ghost" @click="setBacktestRange('6m')">近 6 月</button>
                <button type="button" class="small ghost" @click="setBacktestRange(1)">近 1 年</button>
                <button type="button" class="small ghost" @click="setBacktestRange(3)">近 3 年</button>
                <button type="button" class="small ghost" @click="setBacktestRange(5)">近 5 年</button>
                <button type="button" class="small ghost" @click="setBacktestRange('ytd')">今年以来</button>
              </div>
              <label><span class="field-label">复权方式 <span class="info-tip" tabindex="0" aria-label="复权方式说明" data-tooltip="把分红、送股等造成的价格跳变进行修正。前复权适合观察当前价格下的历史走势；后复权适合衡量长期累计收益。">?</span></span>
                <select v-model="form.adjust">
                  <option value="qfq">qfq 前复权</option>
                  <option value="hfq">hfq 后复权</option>
                  <option value="none">none 不复权</option>
                </select>
              </label>
              <label><span class="field-label">策略 <span class="info-tip" tabindex="0" aria-label="策略说明" data-tooltip="决定什么时候买入和卖出的规则。双均线交叉通常在短期均线上穿长期均线时买入，反向交叉时卖出。">?</span></span>
                <select v-model="form.strategy" @change="applyStrategyDefaults">
                  <option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategyLabel(strategy.key, strategy.label) }}</option>
                </select>
              </label>
              <label v-for="(_, key) in form.strategy_params" :key="key"><span class="field-label">{{ paramLabel(key) }} <span class="info-tip" tabindex="0" :data-tooltip="key === 'fast' ? '短期均线使用的交易日数量。数值越小，对近期价格变化越敏感。' : key === 'slow' ? '长期均线使用的交易日数量。通常应大于快均线周期，用来判断较长期趋势。' : '策略计算该指标时使用的周期参数。'">?</span></span><input type="number" v-model.number="form.strategy_params[key]" /></label>
              <label><span class="field-label">初始资金 <span class="info-tip" tabindex="0" data-tooltip="回测开始时可用的模拟资金，只影响金额曲线，不代表收益率一定更高。">?</span></span><input type="number" v-model.number="form.cash" /></label>
              <label><span class="field-label">单边手续费 (bps) <span class="info-tip" tabindex="0" data-tooltip="每次买入或卖出单独收取的交易成本。1 bps = 0.01%，例如 3 bps = 0.03%。">?</span></span><input type="number" v-model.number="form.commission_bps" /></label>
              <button :disabled="loading">{{ loading ? "回测中..." : "运行回测" }}</button>
            </form>
            <div class="backtest-result">
              <section class="metrics" v-if="result">
                <article><span>策略总收益 <span class="info-tip" tabindex="0" data-tooltip="策略期末相对初始资金的累计涨跌幅，已经计入设置的手续费。">?</span></span><strong>{{ pct(result.stats.total_return) }}</strong></article>
                <article><span>买入持有 <span class="info-tip" tabindex="0" data-tooltip="同一时期买入标的并一直持有的累计收益，用作策略表现的基准。">?</span></span><strong>{{ pct(result.stats.benchmark_return) }}</strong></article>
                <article><span>年化收益 <span class="info-tip" tabindex="0" data-tooltip="把整个回测期收益折算成平均每年的复合收益率，便于比较不同时间长度的回测。">?</span></span><strong>{{ pct(result.stats.annualized_return) }}</strong></article>
                <article><span>最大回撤 <span class="info-tip" tabindex="0" data-tooltip="权益从历史高点到之后最低点的最大跌幅。绝对值越大，代表期间可能承受的亏损压力越大。">?</span></span><strong>{{ pct(result.stats.max_drawdown) }}</strong></article>
                <article><span>夏普比率 <span class="info-tip" tabindex="0" data-tooltip="衡量每承担一单位波动风险获得的收益。通常越高越好，但应结合回撤和样本长度一起判断。">?</span></span><strong>{{ Number(result.stats.sharpe).toFixed(2) }}</strong></article>
                <article><span>交易次数 <span class="info-tip" tabindex="0" data-tooltip="回测期间完成的交易数量。次数太少可能使统计结论不稳定，太多则更受手续费和滑点影响。">?</span></span><strong>{{ result.stats.trade_count }}</strong></article>
              </section>
              <section class="charts" v-if="result">
                <article class="backtest-chart-card">
                  <header><strong>权益曲线</strong><span class="info-tip" tabindex="0" data-tooltip="展示策略资金随时间的变化，并与买入持有比较。曲线越高表示期末资金越多。可滚轮缩放、拖动查看。">?</span></header>
                  <div id="equityChart" class="backtest-chart"></div>
                </article>
                <article class="backtest-chart-card">
                  <header><strong>回撤（%）</strong><span class="info-tip" tabindex="0" data-tooltip="表示当前权益相比此前最高点下跌了多少。0% 代表正处于新高，数值越负代表离历史高点越远。">?</span></header>
                  <div id="drawdownChart" class="backtest-chart"></div>
                </article>
              </section>
              <div v-else class="empty-state">设置参数后运行回测。</div>
            </div>
          </div>
        </section>

        <section v-if="activeModule === 'pi-chat'" class="module-panel">
          <div class="openwebui-shell" :class="{ 'sidebar-hidden': !chatSidebarOpen }">
            <div class="chat-history-sidebar">
              <div class="history-brand"><span class="history-logo">✦</span><strong>Stock AI</strong><button type="button" title="收起侧栏" @click="chatSidebarOpen = false">‹</button></div>
              <button class="history-new" type="button" @click="newChatSession"><span>＋</span> 新对话</button>
              <label class="history-search"><span>⌕</span><input v-model="chatHistoryQuery" placeholder="搜索对话" /></label>
              <div class="history-section">
                <small>最近</small>
                <button v-for="entry in filteredChatHistory()" :key="entry.id" type="button" :class="{ active: entry.id === chatSessionId }" @click="openChatHistory(entry)">
                  <span>◌</span><span>{{ entry.title }}</span><b>···</b>
                </button>
                <p v-if="!filteredChatHistory().length">暂无历史对话</p>
              </div>
              <div class="history-footer"><span>{{ (currentUser?.username || 'U').slice(0, 1).toUpperCase() }}</span><div><strong>{{ currentUser?.username || '用户' }}</strong><small>个人工作区</small></div><b>···</b></div>
            </div>
            <button v-if="!chatSidebarOpen" class="sidebar-reopen" type="button" title="展开侧栏" @click="chatSidebarOpen = true">☰</button>
          <div class="codex-chat">
            <div class="codex-chat-top">
              <div>
                <div class="chat-title"><span class="openai-mark">✦</span><h2>研究助手</h2><span class="status-dot">在线</span></div>
                <div class="chat-session-line">
                  <span>{{ chatSessionId ? 'Session #' + chatSessionId : '新会话' }}</span>
                  <span v-if="chatTrace">{{ chatTrace.model }}</span>
                  <span v-if="chatTrace">{{ chatTrace.role }} · {{ routeLabel(chatTrace.route) }}</span>
                </div>
              </div>
              <button class="chat-new-button" type="button" @click="newChatSession"><span>＋</span> 新对话</button>
            </div>

            <div class="codex-thread" :class="{ empty: !chatMessages.length && !chatReply && !chatThinking && !chatLoading }">
              <template v-if="chatMessages.length || chatReply || chatThinking || chatLoading">
                <article v-for="(item, index) in chatMessages" :key="index" :class="['codex-message', item.role]">
                  <div class="message-avatar">{{ item.role === "user" ? "你" : (item.roleName || "Pi").slice(0, 2) }}</div>
                  <div class="message-body">
                    <strong>{{ item.role === "user" ? "你" : item.roleName }}</strong>
                    <details v-if="item.role === 'assistant' && thinkingText(item.content, item.thinking)" class="thinking-panel">
                      <summary>思考过程</summary>
                      <div class="markdown-body" v-html="thinkingHtml(item.content, item.thinking)"></div>
                    </details>
                    <template v-for="(part, partIndex) in messageParts(item.content)" :key="partIndex">
                      <div v-if="part.type === 'markdown'" class="markdown-body" v-html="part.html"></div>
                      <div v-else class="plugin-render">
                        <strong>{{ part.plugin.title }}</strong>
                        <table v-if="part.plugin.kind === 'table' && Array.isArray(part.plugin.data?.rows)">
                          <thead><tr><th v-for="column in part.plugin.data.columns" :key="column">{{ column }}</th></tr></thead>
                          <tbody><tr v-for="(row, rowIndex) in part.plugin.data.rows" :key="rowIndex"><td v-for="column in part.plugin.data.columns" :key="column">{{ row[column] }}</td></tr></tbody>
                        </table>
                        <div v-else-if="part.plugin.kind === 'card'" class="plugin-card">
                          <p v-for="(value, key) in part.plugin.data" :key="key"><span>{{ key }}</span><strong>{{ value }}</strong></p>
                        </div>
                        <pre v-else>{{ JSON.stringify(part.plugin.data, null, 2) }}</pre>
                      </div>
                    </template>
                  </div>
                </article>
                <article v-if="chatReply || chatThinking || chatLoading" class="codex-message assistant">
                  <div class="message-avatar">{{ (chatTrace?.role || "Pi").slice(0, 2) }}</div>
                  <div class="message-body">
                    <strong>{{ chatTrace?.role || "Pi" }}</strong>
                    <details v-if="thinkingText(chatReply, chatThinking)" class="thinking-panel">
                      <summary>思考过程</summary>
                      <div class="markdown-body" v-html="thinkingHtml(chatReply, chatThinking)"></div>
                    </details>
                    <template v-for="(part, partIndex) in messageParts(chatReply)" :key="partIndex">
                      <div v-if="part.type === 'markdown'" class="markdown-body" v-html="part.html"></div>
                      <div v-else class="plugin-render">
                        <strong>{{ part.plugin.title }}</strong>
                        <table v-if="part.plugin.kind === 'table' && Array.isArray(part.plugin.data?.rows)">
                          <thead><tr><th v-for="column in part.plugin.data.columns" :key="column">{{ column }}</th></tr></thead>
                          <tbody><tr v-for="(row, rowIndex) in part.plugin.data.rows" :key="rowIndex"><td v-for="column in part.plugin.data.columns" :key="column">{{ row[column] }}</td></tr></tbody>
                        </table>
                        <div v-else-if="part.plugin.kind === 'card'" class="plugin-card">
                          <p v-for="(value, key) in part.plugin.data" :key="key"><span>{{ key }}</span><strong>{{ value }}</strong></p>
                        </div>
                        <pre v-else>{{ JSON.stringify(part.plugin.data, null, 2) }}</pre>
                      </div>
                    </template>
                    <span v-if="chatLoading" class="chat-cursor">▍</span>
                    <div v-if="chatTrace" class="chat-trace compact">
                      <span>{{ chatTrace.model }}</span>
                      <span>{{ routeLabel(chatTrace.route) }}</span>
                      <span>Skills {{ chatTrace.skills?.length || 0 }}</span>
                      <span>Plugins {{ chatTrace.plugins?.length || 0 }}</span>
                    </div>
                  </div>
                </article>
              </template>
              <template v-else>
                <div class="codex-empty">
                  <div class="empty-logo">✦</div>
                  <h3>有什么可以帮忙的？</h3>
                  <p>选择一个开始方式，或直接在下方输入问题。</p>
                  <div class="starter-grid">
                    <button v-for="starter in chatStarters" :key="starter.title" type="button" class="starter-card" @click="useChatStarter(starter)">
                      <span>{{ starter.icon }}</span><strong>{{ starter.title }}</strong><small>{{ starter.prompt }}</small>
                    </button>
                  </div>
                </div>
              </template>
            </div>

            <form class="codex-composer" @submit.prevent="startChat">
              <div class="role-chip-row">
                <button v-for="role in roles" :key="role.id" type="button" class="role-chip" @click="insertRoleMention(role)">@{{ role.name }}</button>
              </div>
              <div class="stock-chip-row" v-if="subscriptions.length">
                <button v-for="stock in subscriptions" :key="stock.id" type="button" class="stock-chip" @click="insertStockMention(stock)">#{{ stock.symbol }} {{ stock.stockName }}</button>
              </div>
              <div ref="chatComposer" class="rich-composer" contenteditable="true" data-placeholder="给研究助手发送消息…" @input="syncComposer" @keydown.enter.exact.prevent="startChat"></div>
              <div class="composer-actions">
                <label class="composer-select">模型
                  <select v-model="chatForm.modelConfigId" title="本轮使用的模型" @change="selectChatModelConfig">
                    <option v-for="config in modelConfigs" :key="config.id" :value="config.id">{{ config.name }} · {{ config.model }}</option>
                    <option v-if="!modelConfigs.length" value="">{{ modelSettings.model }}</option>
                  </select>
                </label>
                <select v-model="chatForm.roleId" title="默认角色">
                  <option value="">自动</option>
                  <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
                </select>
                <span class="composer-hint">Enter 发送</span>
                <button class="send-button" :disabled="chatLoading || !chatForm.message.trim()" :aria-label="chatLoading ? '生成中' : '发送消息'">{{ chatLoading ? "…" : "↑" }}</button>
              </div>
            </form>
          </div>
          </div>
        </section>

        <section v-if="activeModule === 'pi-tasks'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>任务管理</h2>
              <p>把常用工作流固定成任务：选择角色、调度方式、任务提示词，后续由 Pi Runtime 执行。</p>
            </div>
          </div>
          <form class="role-form task-form" @submit.prevent="saveTask">
            <label>任务名称<input v-model.trim="taskForm.name" /></label>
            <label>执行角色
              <select v-model="taskForm.roleId">
                <option value="">选择角色</option>
                <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
              </select>
            </label>
            <label>调度方式
              <select v-model="taskForm.schedule">
                <option value="manual">手动执行</option>
                <option value="daily">每日</option>
                <option value="weekly">每周</option>
              </select>
            </label>
            <label>执行模型
              <select v-model="taskForm.modelConfigId">
                <option v-for="config in modelConfigs" :key="config.id" :value="config.id">{{ config.name }} · {{ config.model }}</option>
                <option v-if="!modelConfigs.length" value="">{{ modelSettings.model }}</option>
              </select>
            </label>
            <label>任务提示词<textarea v-model.trim="taskForm.prompt"></textarea></label>
            <button>保存任务</button>
          </form>
          <div class="card-grid" v-if="savedTasks.length">
            <article v-for="task in savedTasks" :key="task.id" class="feature-card">
              <h3>{{ task.name }}</h3><p>{{ task.modelName }} · {{ task.schedule }}</p><p>{{ task.prompt }}</p>
              <button type="button" class="small danger" @click="deleteTask(task.id)">删除</button>
            </article>
          </div>
        </section>

        <section v-if="activeModule === 'pi-roles'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>角色管理</h2>
              <p>角色决定 Pi Runtime 的身份、职责边界，并可勾选允许使用的 Skill 与插件。</p>
            </div>
          </div>
          <form class="role-form" @submit.prevent="addRole">
            <label>角色名称<input v-model.trim="roleForm.name" placeholder="如：行情观察员 / 策略研究员 / 风控审查员" /></label>
            <label>角色职责<textarea v-model.trim="roleForm.responsibility" placeholder="这个角色负责什么事情？"></textarea></label>
            <label>系统提示词<textarea v-model.trim="roleForm.systemPrompt" placeholder="给这个角色的行为边界和输出要求"></textarea></label>
            <button>新增角色</button>
          </form>
          <div v-if="!roles.length" class="empty-state">还没有配置角色。</div>
          <div class="role-grid">
            <article v-for="role in roles" :key="role.id" class="role-card">
              <div class="card-title">
                <strong>{{ role.name }}</strong>
                <button class="small danger" @click="removeRole(role.id)">删除</button>
              </div>
              <p>{{ role.responsibility }}</p>
              <div class="capability-panel">
                <h3>Skill</h3>
                <label v-for="skill in skills" :key="'skill-' + role.id + '-' + skill.id" class="check-item">
                  <input type="checkbox" :checked="(role.skillIds ?? []).includes(skill.id)" @change="toggleRoleId(role.skillIds, skill.id)" />
                  <span>{{ skill.name }}</span>
                </label>
                <div v-if="!skills.length" class="hint dark">还没有 Skill。</div>
              </div>
              <div class="capability-panel">
                <h3>插件</h3>
                <label v-for="plugin in plugins" :key="'plugin-' + role.id + '-' + plugin.id" class="check-item">
                  <input type="checkbox" :checked="(role.pluginIds ?? []).includes(plugin.id)" @change="toggleRoleId(role.pluginIds, plugin.id)" />
                  <span>{{ plugin.name }} · {{ pluginStatusLabel(plugin.status) }}</span>
                </label>
                <div v-if="!plugins.length" class="hint dark">还没有插件。</div>
              </div>
              <button class="small" @click="saveRoleCapabilities(role)">保存能力</button>
              <p class="hint dark">已选 Skill：{{ roleSkillNames(role) }}</p>
              <p class="hint dark">已选插件：{{ rolePluginNames(role) }}</p>
            </article>
          </div>
        </section>

        <section v-if="activeModule === 'pi-skills'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>Skill 管理</h2>
              <p>Skill 是稳定能力包，可以上传策略规则、工具使用规范、研究流程或领域知识，再授权给角色使用。</p>
            </div>
          </div>
          <form class="role-form" @submit.prevent="addSkill">
            <label>Skill 名称<input v-model.trim="skillForm.name" placeholder="如：A 股行情分析" /></label>
            <label>说明<input v-model.trim="skillForm.description" placeholder="这个 Skill 提供什么能力" /></label>
            <div class="import-row">
              <label class="file-button">导入 ZIP<input type="file" accept=".zip" @change="importSkillZip" /></label>
              <label class="file-button">导入文件夹<input type="file" webkitdirectory multiple @change="importSkillFolder" /></label>
              <span v-if="skillUploadSummary" class="hint dark">{{ skillUploadSummary }}</span>
            </div>
            <label>Skill 内容<textarea v-model.trim="skillForm.content" placeholder="粘贴 Skill Markdown / 提示词 / 工具说明"></textarea></label>
            <button>上传 Skill</button>
          </form>
          <div class="role-grid">
            <article v-for="skill in skills" :key="skill.id" class="role-card">
              <div class="card-title">
                <strong>{{ skill.name }}</strong>
                <button class="small danger" @click="removeSkill(skill.id)">删除</button>
              </div>
              <p>{{ skill.description }}</p>
              <p class="hint dark">来源：{{ sourceTypeLabel(skill.sourceType) }}<span v-if="skill.packageName"> · {{ skill.packageName }}</span></p>
              <p v-if="skill.packageFiles?.length" class="hint dark">包文件：{{ skill.packageFiles.length }} 个</p>
              <pre>{{ skill.content }}</pre>
            </article>
          </div>
        </section>

        <section v-if="activeModule === 'pi-plugins'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>插件管理</h2>
              <p>插件是可编辑、可发布、可下线的运行时模块。角色可以选择允许使用哪些插件。</p>
            </div>
            <button class="small" @click="importPluginFromTemplate">在线导入模板</button>
          </div>
          <div class="plugin-layout">
            <form class="role-form" @submit.prevent="savePlugin">
              <label>插件名称<input v-model.trim="pluginForm.name" /></label>
              <label>说明<input v-model.trim="pluginForm.description" /></label>
              <label>来源 URL<input v-model.trim="pluginForm.sourceUrl" placeholder="https:// 或 local://，可选" /></label>
              <div class="import-row">
                <label class="file-button">导入 ZIP<input type="file" accept=".zip" @change="importPluginZip" /></label>
                <label class="file-button">导入文件夹<input type="file" webkitdirectory multiple @change="importPluginFolder" /></label>
                <span v-if="pluginUploadSummary" class="hint dark">{{ pluginUploadSummary }}</span>
              </div>
              <label>插件代码<textarea class="code-editor" v-model="pluginForm.code"></textarea></label>
              <div class="button-row">
                <button>{{ pluginForm.id ? "保存插件" : "新增插件" }}</button>
                <button type="button" class="ghost" @click="resetPluginForm">清空</button>
              </div>
            </form>
            <div class="plugin-list">
              <article v-for="plugin in plugins" :key="plugin.id" class="role-card">
                <div class="card-title">
                  <div>
                    <strong>{{ plugin.name }}</strong>
                    <span>{{ pluginStatusLabel(plugin.status) }}</span>
                  </div>
                </div>
                <p>{{ plugin.description }}</p>
                <p class="hint dark">来源：{{ sourceTypeLabel(plugin.sourceType) }}<span v-if="plugin.packageName"> · {{ plugin.packageName }}</span></p>
                <p v-if="plugin.packageFiles?.length" class="hint dark">包文件：{{ plugin.packageFiles.length }} 个</p>
                <div class="button-row">
                  <button class="small" @click="editPlugin(plugin)">编辑</button>
                  <button class="small" @click="publishPlugin(plugin.id)">发布</button>
                  <button class="small" @click="offlinePlugin(plugin.id)">下线</button>
                  <button class="small danger" @click="removePlugin(plugin.id)">删除</button>
                </div>
                <p class="hint dark">更新：{{ formatTime(plugin.updatedAt) }}</p>
              </article>
            </div>
          </div>
        </section>

        <section v-if="activeModule === 'settings'" class="module-panel system-settings">
          <div class="panel-head system-page-head">
            <div>
              <span class="section-kicker">SYSTEM SETTINGS</span>
              <h2>系统管理</h2>
              <p>统一管理平台的数据源与 AI 模型，保存后将应用到行情、回测和 Pi Runtime 任务。</p>
            </div>
          </div>
          <div class="system-settings-grid">
            <form class="settings-form system-form data-source-card" @submit.prevent="saveDataSourceSettings">
              <div class="settings-card-head">
                <div class="settings-card-icon">数</div>
                <div><h3>行情数据源</h3><p>设置全局默认的行情服务</p></div>
              </div>
              <label>默认数据源
                <select v-model="dataSourceSettings.dataSource">
                  <option value="auto">自动数据源（AkShare/Yahoo）</option>
                  <option value="futu">Futu OpenD</option>
                </select>
              </label>
              <div class="button-row">
                <button type="button" class="small ghost" @click="openBacktestStrategyEditor()">新增 JSON 策略</button>
                <button v-if="strategies.find(item => item.key === form.strategy)?.source === 'custom'" type="button" class="small ghost" @click="editSelectedBacktestStrategy">编辑策略</button>
                <button v-if="strategies.find(item => item.key === form.strategy)?.source === 'custom'" type="button" class="small danger" @click="removeSelectedBacktestStrategy">删除策略</button>
              </div>
              <section v-if="showBacktestStrategyEditor" class="strategy-json-editor">
                <label>策略名称<input v-model.trim="backtestStrategyForm.name" maxlength="80" /></label>
                <label>策略说明<input v-model.trim="backtestStrategyForm.description" /></label>
                <label>JSON 定义<textarea v-model="backtestStrategyForm.definitionText" rows="18" spellcheck="false"></textarea></label>
                <small>指标支持 sma、ema、rsi；条件支持 &gt;、&gt;=、&lt;、&lt;=、==、!=、crosses_above、crosses_below；操作数可用指标名、close 或数字。</small>
                <div class="button-row">
                  <button type="button" class="small" @click="saveBacktestStrategy">保存策略</button>
                  <button type="button" class="small ghost" @click="showBacktestStrategyEditor = false">取消</button>
                </div>
              </section>
              <div v-if="dataSourceSettings.dataSource === 'futu'" class="source-panel">
                <h4>Futu OpenD 服务器</h4>
                <div class="source-grid compact">
                  <label>Host<input v-model.trim="dataSourceSettings.futuHost" placeholder="127.0.0.1" /></label>
                  <label>Port<input type="number" v-model.number="dataSourceSettings.futuPort" min="1" max="65535" /></label>
                </div>
              </div>
              <div class="settings-card-footer">
                <button :disabled="settingsSaving">{{ settingsSaving ? "保存中..." : "保存并切换" }}</button>
                <p class="hint dark">Futu 适合实时行情与交易；未启动时可使用自动数据源。</p>
              </div>
              <div v-if="settingsMessage" class="success">{{ settingsMessage }}</div>
            </form>

            <form class="settings-form system-form model-settings-card" @submit.prevent="saveModelSettings">
              <div class="settings-card-head">
                <div class="settings-card-icon purple">模</div>
                <div><h3>模型配置</h3><p>管理 Pi Runtime 使用的推理模型</p></div>
                <button type="button" class="small secondary-action" @click="newModelConfig">＋ 新增模型</button>
              </div>
              <div class="role-chip-row model-config-tabs" v-if="modelConfigs.length">
                <button v-for="config in modelConfigs" :key="config.id" type="button" class="role-chip" :class="{ active: modelSettings.id === config.id }" @click="editModelConfig(config)"><span v-if="config.isDefault" class="default-dot"></span>{{ config.name }}</button>
              </div>
              <div class="model-form-grid">
                <label>配置名称<input v-model.trim="modelSettings.name" placeholder="如：GLM-4.5 / 本地 Qwen" /></label>
                <label>模型提供方
                  <select v-model="modelSettings.provider">
                    <option value="ollama">Ollama 本地模型</option>
                    <option value="openai">OpenAI 兼容 API（OpenAI / GLM / DeepSeek 等）</option>
                  </select>
                </label>
                <label>模型名称<input v-model.trim="modelSettings.model" placeholder="qwen2.5-coder:14b" /></label>
                <label>Base URL<input v-model.trim="modelSettings.baseUrl" placeholder="http://127.0.0.1:11434" /></label>
              </div>
              <div v-if="modelSettings.provider === 'openai'" class="source-panel api-key-panel">
                <label>API Key 环境变量名<input v-model.trim="modelSettings.apiKeyRef" placeholder="OPENAI_API_KEY" /></label>
              </div>
              <div class="advanced-settings">
                <h4>生成参数</h4>
                <div class="parameter-grid">
                  <label>Temperature<input type="number" min="0" max="2" step="0.1" v-model.number="modelSettings.temperature" /></label>
                  <label>最大输出 Token<input type="number" min="256" max="131072" v-model.number="modelSettings.maxOutputTokens" /></label>
                  <label>上下文预算 Token<input type="number" min="1024" max="1048576" v-model.number="modelSettings.contextBudgetTokens" /></label>
                  <label>推理强度
                <select v-model="modelSettings.reasoningEffort">
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
                  </label>
                </div>
              </div>
              <label class="default-model-toggle"><input type="checkbox" v-model="modelSettings.isDefault" /><span><strong>设为默认模型</strong><small>新任务将优先使用此配置</small></span></label>
              <div class="model-form-actions">
                <div class="button-row">
                  <button :disabled="settingsSaving">{{ settingsSaving ? "保存中..." : "保存模型配置" }}</button>
                  <button type="button" class="small outline-button" :disabled="settingsSaving" @click="testModelConnection">测试连接</button>
                  <button v-if="modelSettings.id" type="button" class="small danger ghost-danger" @click="deleteModelConfig(modelSettings)">删除</button>
                </div>
                <p class="hint dark">Ollama 无需 API Key；兼容服务的密钥请通过服务器环境变量配置。</p>
              </div>
            </form>
          </div>
        </section>
      </main>
    </div>
  `,
});

app.use(router);
app.mount("#app");
