import { createApp, nextTick } from "vue";
import { dispose, init } from "klinecharts";
import { configStore, llmClient, registerProvider } from "@anvaka/vue-llm";
import "@anvaka/vue-llm/styles/variables.css";
import MarkdownIt from "markdown-it";
import ArcoVue from "@arco-design/web-vue";
import "@arco-design/web-vue/dist/arco.css";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import { BubbleList, Thinking } from "vue-element-plus-x";
import { IconStar, IconStarFill } from "@arco-design/web-vue/es/icon";
import AppShell from "./components/AppShell.vue";
import BacktestForm from "./components/backtest/BacktestForm.vue";
import BacktestResults from "./components/backtest/BacktestResults.vue";
import BacktestStrategyManager from "./components/backtest/BacktestStrategyManager.vue";
import RichChatComposer from "./components/chat/RichChatComposer.vue";
import DashboardViewControls from "./components/dashboard/DashboardViewControls.vue";
import StockChartControls from "./components/dashboard/StockChartControls.vue";
import SubscriptionTable from "./components/dashboard/SubscriptionTable.vue";
import SubscriptionDrawer from "./components/dashboard/SubscriptionDrawer.vue";
import { findPrimaryKey, primaryNavigation } from "./navigation.js";
import { chartThemeStyles } from "./chartTheme.js";
import { PI_RUNTIME_PROVIDER, PiRuntimeProvider } from "./piLlmProvider.js";
import { moduleRoutes, router } from "./router.js";
import "./style.css";
import "./themes.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";
const APP_THEMES = new Set(["midnight", "obsidian", "daylight"]);
const savedAppTheme = localStorage.getItem("alphadock-theme");
const initialAppTheme = APP_THEMES.has(savedAppTheme) ? savedAppTheme : "midnight";

function applyAppTheme(theme) {
  const normalized = APP_THEMES.has(theme) ? theme : "midnight";
  document.documentElement.dataset.theme = normalized;
  document.documentElement.classList.toggle("dark", normalized !== "daylight");
  document.body.setAttribute("arco-theme", normalized === "daylight" ? "light" : "dark");
  return normalized;
}

applyAppTheme(initialAppTheme);
const dashboardCharts = new Map();
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
markdown.inline.ruler.before("link", "role_mention", (state, silent) => {
  const match = state.src.slice(state.pos).match(/^\[@\s+id="role:([^"]+)"\s+label="([^"]+)"\]/);
  if (!match) return false;
  if (!silent) state.push("role_mention", "span", 0).content = match[2];
  state.pos += match[0].length;
  return true;
});
markdown.renderer.rules.role_mention = (tokens, index) => `<span class="chat-mention">@${markdown.utils.escapeHtml(tokens[index].content)}</span>`;
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

function inferModelCapabilities(config = {}) {
  const model = String(config.model || "").toLowerCase();
  const explicitlyVision = config.supportsImages ?? config.supportsVision;
  const visionPattern = /(qwen[^\s:]*-?vl|qvq|llava|bakllava|moondream|minicpm-v|gemma3|vision|gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|gemini)/i;
  return {
    images: explicitlyVision == null ? visionPattern.test(model) : Boolean(explicitlyVision),
    files: config.supportsFiles == null ? true : Boolean(config.supportsFiles),
  };
}

function startForRange(range) {
  return isoDate({ day: 14, week: 30, month: 70, halfYear: 220, year: 400 }[range] ?? 70);
}

function isMarketTradingNow(market, now = new Date()) {
  const schedules = {
    "A Share": { timeZone: "Asia/Shanghai", sessions: [[570, 690], [780, 900]] },
    "Hong Kong": { timeZone: "Asia/Hong_Kong", sessions: [[570, 720], [780, 960]] },
    US: { timeZone: "America/New_York", sessions: [[570, 960]] },
  };
  const schedule = schedules[market];
  if (!schedule) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  if (["Sat", "Sun"].includes(value("weekday"))) return false;
  const minute = Number(value("hour")) * 60 + Number(value("minute"));
  return schedule.sessions.some(([start, end]) => minute >= start && minute < end);
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

const projectColumns = [
  { title: "项目名称", slotName: "projectName", width: 190 },
  { title: "项目说明", slotName: "description", ellipsis: true, tooltip: true },
  { title: "角色成员", slotName: "roles", width: 180 },
  { title: "公共能力", slotName: "capabilities", width: 145 },
  { title: "任务数", dataIndex: "conversationCount", width: 90 },
  { title: "更新时间", slotName: "updatedAt", width: 170 },
  { title: "操作", slotName: "actions", width: 250, fixed: "right" },
];

const roleColumns = [
  { title: "角色", slotName: "role", width: 220 },
  { title: "职责说明", dataIndex: "responsibility", ellipsis: true, tooltip: true },
  { title: "默认模型", slotName: "model", width: 180 },
  { title: "能力配置", slotName: "capabilities", width: 190 },
  { title: "创建时间", slotName: "createdAt", width: 180 },
  { title: "操作", slotName: "actions", width: 220, fixed: "right" },
];

const app = createApp({
  components: { AppShell, BacktestForm, BacktestResults, BacktestStrategyManager, BubbleList, Thinking, RichChatComposer, DashboardViewControls, StockChartControls, SubscriptionTable, SubscriptionDrawer, IconStar, IconStarFill },
  data() {
    return {
      token: localStorage.getItem("stock-harness-token") ?? sessionStorage.getItem("stock-harness-token") ?? "",
      authMode: "login",
      auth: { username: "admin", password: "", rememberMe: true },
      appTheme: initialAppTheme,
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
        providerChains: {
          "A Share": ["akshare", "baostock", "yfinance"],
          "Hong Kong": ["futu", "akshare", "yfinance"],
          US: ["sec_edgar", "futu", "yfinance"],
        },
        futuHost: "127.0.0.1",
        futuPort: 11111,
        tushareToken: "",
        hasTushareToken: false,
        updatedAt: null,
      },
      displaySettings: {
        marketColors: { "A Share": "red-up", "Hong Kong": "red-up", US: "green-up" },
        updatedAt: null,
      },
      httpDataSources: [],
      dataSourceDrawerOpen: false,
      dataSourceRoutingOpen: false,
      dataSourceTesting: false,
      dataSourceTestMessage: "",
      httpDataSourceForm: { id: null, name: "", key: "", baseUrl: "https://", method: "GET", authType: "none", authConfig: { secretRef: "", headerName: "x-api-key", signatureHeader: "x-signature", timestampHeader: "x-timestamp", algorithm: "sha256" }, headersText: "{}", markets: ["A Share"], capabilities: ["bars"], adapterScript: "function adapt(payload) {\n  return (payload.data || []).map(item => ({\n    date: item.date, open: Number(item.open), high: Number(item.high),\n    low: Number(item.low), close: Number(item.close), volume: Number(item.volume || 0)\n  }));\n}" },
      modelSettings: {
        id: null,
        name: "本地 Qwen",
        provider: "ollama",
        model: "qwen2.5-coder:14b",
        baseUrl: "http://127.0.0.1:11434",
        apiKeyRef: "",
        apiKey: "",
        temperature: 0.2,
        maxOutputTokens: 4096,
        contextBudgetTokens: 32768,
        reasoningEffort: "medium",
        updatedAt: null,
      },
      modelConfigs: [],
      systemPrivateModels: [],
      systemOllamaBaseUrl: "http://127.0.0.1:11434",
      monitoringRange: "month",
      monitoringScope: "mine",
      monitoringLoading: false,
      modelMonitoring: { summary: {}, trend: [], models: [], projects: [], users: [] },
      modelDrawerOpen: false,
      modelTesting: false,
      modelTestMessage: "",
      roles: [],
      skills: [],
      plugins: [],
      projects: [],
      activeProjectId: Number(localStorage.getItem("stock-harness-active-project") || 0) || null,
      projectForm: { id: null, name: "", description: "", instructions: "", roleIds: [], skillIds: [], pluginIds: [] },
      projectDialogMode: null,
      selectedProject: null,
      projectStatusView: "active",
      projectSaving: false,
      projectColumns,
      roleForm: {
        id: null,
        name: "策略研究员",
        avatar: "",
        responsibility: "把用户的策略想法拆成可回测的规则和参数。",
        systemPrompt: "你是策略研究员，只输出可验证、可回测、可解释的策略方案。",
        modelConfigId: "",
      },
      skillForm: {
        id: null,
        name: "",
        description: "",
        content: "",
        visibility: "private",
        package: null,
      },
      skillView: "market",
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
        schedule: "daily",
        prompt: "总结订阅股票今天的走势、异常波动和明天观察点。",
        modelConfigId: "",
      },
      chatForm: {
        roleId: "",
        model: "",
        modelConfigId: "",
        message: "帮我分析 600519 最近的走势，并给出可回测的策略假设。",
      },
      taskDrawerOpen: false,
      roleDrawerOpen: false,
      roleSaving: false,
      roleColumns,
      roleCapabilityDrawerOpen: false,
      selectedRole: null,
      skillDrawerOpen: false,
      skillPreviewOpen: false,
      selectedSkillPreview: null,
      skillPreviewMode: "rendered",
      skillPreviewFiles: [],
      skillPreviewEntry: null,
      skillPreviewFilePath: null,
      skillPreviewLoading: false,
      pluginDrawerOpen: false,
      savedTasks: JSON.parse(localStorage.getItem("stock-harness-pi-tasks") || "[]"),
      taskProjectFilterId: null,
      chatLoading: false,
      chatRecoveryTimer: null,
      chatSessionId: null,
      chatMessages: [],
      chatReply: "",
      chatThinking: "",
      chatTrace: null,
      chatAttachments: [],
      chatSidebarOpen: true,
      expandedProjectIds: JSON.parse(localStorage.getItem("stock-harness-expanded-projects") || "[]"),
      chatHistoryQuery: "",
      archivedChatsOpen: false,
      chatHistory: JSON.parse(localStorage.getItem("stock-harness-chat-history") || "[]"),
      projectArtifacts: JSON.parse(localStorage.getItem("stock-harness-project-artifacts") || "[]"),
      artifactWorkspaceOpen: false,
      selectedArtifactId: null,
      artifactEditing: false,
      artifactDraft: "",
      chatStateReady: false,
      chatStarters: [
        { icon: "⌁", title: "市场复盘", prompt: "总结今天关注标的的走势、异动和明日观察点。" },
        { icon: "↗", title: "策略研究", prompt: "基于我的订阅股票，提出一个可回测的交易策略假设。" },
        { icon: "◎", title: "风险检查", prompt: "检查当前关注标的可能存在的风险，并按重要性排序。" },
      ],
      availableModels: [],
      chatModelChoices: [],
      subscriptions: [],
      draggedSubscriptionId: null,
      draggedOverSubscriptionId: null,
      dashboardViewMode: localStorage.getItem("stock-harness-dashboard-view") || "cards",
      subscriptionDrawerOpen: false,
      subscriptionBatchLoading: false,
      dashboardColumns: Number(localStorage.getItem("stock-harness-dashboard-columns") || 4),
      subscriptionChartSettings: JSON.parse(localStorage.getItem("stock-harness-chart-settings") || "{}"),
      chartLoadingIds: [],
      subscriptionForm: {
        market: "A Share",
        symbol: "600519",
        stockName: "",
        remark: "",
      },
      symbolSuggestions: [],
      selectedRange: "month",
      selectedInterval: "1d",
      customRangeStart: isoDate(30),
      customRangeEnd: isoDate(),
      chartLocale: "zh-CN",
      chartData: {},
      marketStats: {},
      chartErrors: {},
      fundamentalData: {},
      fundamentalErrors: {},
      currentPrices: {},
      currentPriceTimer: null,
      fundamentalMetricLabels,
      labelStrategyTemplates: [],
      labelStrategies: [],
      labelBindings: [],
      subscriptionLabels: {},
      labelStrategyRunId: null,
      labelStrategyMessage: "",
      isStrategyModalOpen: false,
      isBindingDrawerOpen: false,
      strategyForm: {
        name: "高 ROE 现金牛",
        targetLabel: "好公司",
        conditions: [
          { metric: "roe", op: ">=", value: 0.15 },
          { metric: "operating_cash_flow", op: ">", value: 0 },
        ],
      },
      bindingForm: {
        subscriptionIds: [],
        strategyId: "",
        scope: "selected",
        activeSessions: ["market"],
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
    allDataSources() {
      const builtins = [
        { key: "akshare", name: "AkShare", protocol: "Python SDK", authType: "none", markets: ["A Share", "Hong Kong"], capabilities: ["bars", "symbols", "fundamentals"], enabled: true, builtin: true },
        { key: "baostock", name: "BaoStock", protocol: "Python SDK", authType: "none", markets: ["A Share"], capabilities: ["bars"], enabled: true, builtin: true },
        { key: "tushare", name: "Tushare Pro", protocol: "Python SDK", authType: "token", markets: ["A Share"], capabilities: ["bars"], enabled: true, builtin: true },
        { key: "futu", name: "Futu OpenD", protocol: "TCP / OpenD", authType: "none", markets: ["A Share", "Hong Kong", "US"], capabilities: ["bars", "quote", "fundamentals"], enabled: true, builtin: true },
        { key: "yfinance", name: "Yahoo Finance", protocol: "HTTP", authType: "none", markets: ["A Share", "Hong Kong", "US"], capabilities: ["bars", "fundamentals"], enabled: true, builtin: true },
        { key: "sec_edgar", name: "SEC EDGAR", protocol: "HTTP", authType: "none", markets: ["US"], capabilities: ["fundamentals"], enabled: true, builtin: true },
      ];
      return [...builtins, ...this.httpDataSources.map((item) => ({ ...item, protocol: "HTTP" }))];
    },
    activePrimary() {
      return findPrimaryKey(this.activeModule);
    },
    activeProject() {
      return this.projects.find((item) => item.id === this.activeProjectId) ?? null;
    },
    activeProjectArtifacts() {
      if (!this.activeProjectId) return [];
      return this.projectArtifacts
        .filter((item) => Number(item.projectId) === Number(this.activeProjectId))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    selectedArtifact() {
      return this.projectArtifacts.find((item) => item.id === this.selectedArtifactId) ?? null;
    },
    activeProjects() {
      return this.projects.filter((item) => !item.archived_at);
    },
    archivedProjects() {
      return this.projects.filter((item) => Boolean(item.archived_at));
    },
    displayedProjects() {
      return this.projectStatusView === "archived" ? this.archivedProjects : this.activeProjects;
    },
    projectTasks() {
      if (!this.taskProjectFilterId) return this.savedTasks;
      return this.savedTasks.filter((item) => Number(item.projectId) === Number(this.taskProjectFilterId));
    },
    chatRoles() {
      if (!this.activeProject) return this.roles;
      const ids = new Set(this.activeProject.roleIds || []);
      return this.roles.filter((item) => ids.has(item.id));
    },
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
    ownedSkills() {
      return this.skills.filter((skill) => skill.owned && !skill.isSystem);
    },
    marketSkills() {
      return this.skills.filter((skill) => !skill.isSystem && skill.visibility === "public");
    },
    systemSkills() {
      return this.skills.filter((skill) => skill.isSystem);
    },
    displayedSkills() {
      if (this.skillView === "mine") return this.ownedSkills;
      if (this.skillView === "system") return this.systemSkills;
      return this.marketSkills;
    },
    selectedSkillFile() {
      return this.skillPreviewFiles.find((file) => file.path === this.skillPreviewFilePath) || null;
    },
    selectedSkillFileContent() {
      return this.selectedSkillFile?.content ?? "";
    },
    selectedSkillReferences() {
      const content = this.selectedSkillFileContent;
      const currentDir = String(this.skillPreviewFilePath || "").split("/").slice(0, -1);
      const references = [];
      for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)#?]+)(?:#[^)]+)?\)|(?:^|\s)(references\/[^\s`)'\"]+)/gim)) {
        const raw = String(match[1] || match[2] || "").replace(/^\.\//, "");
        const parts = raw.startsWith("/") ? raw.slice(1).split("/") : [...currentDir, ...raw.split("/")];
        const normalized = [];
        for (const part of parts) part === ".." ? normalized.pop() : part !== "." && normalized.push(part);
        const path = normalized.join("/");
        if (this.skillPreviewFiles.some((file) => file.path === path) && !references.includes(path)) references.push(path);
      }
      return references;
    },
    elementChatMessages() {
      const items = this.chatMessages.map((item, index) => ({
        ...item,
        id: item.id ?? `message-${index}`,
        placement: item.role === "user" ? "end" : "start",
        variant: item.role === "user" ? "filled" : "borderless",
        shape: "corner",
        maxWidth: item.role === "user" ? "82%" : "100%",
      }));
      if (this.chatReply || this.chatThinking || this.chatLoading) {
        items.push({
          id: "streaming-assistant",
          role: "assistant",
          roleName: this.chatTrace?.role || "Pi",
          content: this.chatReply,
          thinking: this.chatThinking,
          placement: "start",
          variant: "borderless",
          shape: "corner",
          maxWidth: "100%",
          loading: this.chatLoading && !this.chatReply && !this.chatThinking,
          streaming: true,
        });
      }
      return items;
    },
    selectedChatModelConfig() {
      return this.modelConfigs.find((item) => item.id === Number(this.chatForm.modelConfigId)) ?? this.modelSettings;
    },
    chatModelSelection: {
      get() {
        return `${this.chatForm.modelConfigId || this.selectedChatModelConfig?.id || ""}::${this.chatForm.model || this.selectedChatModelConfig?.model || ""}`;
      },
      set(value) {
        const separator = String(value).indexOf("::");
        if (separator < 0) return;
        this.chatForm.modelConfigId = String(value).slice(0, separator);
        this.chatForm.model = String(value).slice(separator + 2);
      },
    },
    chatModelCapabilities() {
      return inferModelCapabilities({ ...this.selectedChatModelConfig, model: this.chatForm.model || this.selectedChatModelConfig?.model });
    },
  },
  watch: {
    "$route.fullPath": {
      immediate: true,
      async handler() {
        await this.activateModule(this.$route.meta.module ?? "dashboard");
        if (this.chatStateReady && this.$route.meta.module === "pi-chat") this.restoreChatRoute();
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
    if (this.currentPriceTimer) clearInterval(this.currentPriceTimer);
    if (this.chatRecoveryTimer) clearTimeout(this.chatRecoveryTimer);
    disposeDashboardCharts();
  },
  methods: {
    setAppTheme(theme) {
      this.appTheme = applyAppTheme(theme);
      localStorage.setItem("alphadock-theme", this.appTheme);
      if (this.activeModule === "dashboard") nextTick(() => this.renderDashboardCharts());
    },
    setPrimaryModule(primaryKey) {
      const target = primaryNavigation.find((item) => item.key === primaryKey);
      if (target) this.setModule(target.defaultModule);
    },
    async bootstrap() {
      await this.loadMe();
      await Promise.all([
        this.loadDataSourceSettings(),
        this.loadDisplaySettings(),
        this.loadHttpDataSources(),
        this.loadModelSettings(),
        this.loadStrategies(),
        this.loadSubscriptions(),
        this.loadLabelStrategyTemplates(),
        this.loadLabelStrategies(),
        this.loadLabelBindings(),
        this.loadRoles(),
        this.loadSkills(),
        this.loadPlugins(),
        this.loadProjects(),
      ]);
      await this.loadChatHistory();
      this.chatStateReady = true;
      if (this.$route.meta.module === "pi-chat") this.restoreChatRoute();
      await this.refreshCurrentPrices(true);
      this.currentPriceTimer = setInterval(() => void this.refreshCurrentPrices(false), 60_000);
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
      if (this.$route.name !== route.name) {
        const target = moduleName === "pi-chat"
          ? { name: route.name, params: { projectId: "my", conversationId: "new" } }
          : { name: route.name };
        await this.$router.push(target);
      }
    },
    navigateModule(moduleName) {
      if (moduleName === "pi-tasks") this.taskProjectFilterId = null;
      this.setModule(moduleName);
    },
    async activateModule(moduleName) {
      if (moduleName !== "dashboard") disposeDashboardCharts();
      this.activeModule = moduleName;
      this.error = "";
      this.settingsMessage = "";
      if (moduleName === "dashboard") {
        await nextTick();
        this.renderDashboardCharts();
      }
      if (moduleName === "model-monitoring" && this.token) await this.loadModelMonitoring();
    },
    async loadDataSourceSettings() {
      this.dataSourceSettings = await this.api("/settings/data-source");
    },
    async loadDisplaySettings() {
      this.displaySettings = await this.api("/settings/display");
    },
    marketColorStyle(market) {
      const redUp = this.displaySettings.marketColors[market] !== "green-up";
      return redUp
        ? { upColor: "#ef4444", downColor: "#16a34a" }
        : { upColor: "#16a34a", downColor: "#ef4444" };
    },
    async saveDisplaySettings() {
      this.settingsSaving = true;
      this.settingsMessage = "";
      this.error = "";
      try {
        this.displaySettings = await this.api("/settings/display", { method: "PUT", body: JSON.stringify(this.displaySettings) });
        this.settingsMessage = "显示偏好已保存，并已应用到各市场行情图。";
        await nextTick();
        this.renderDashboardCharts();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.settingsSaving = false;
      }
    },
    async loadHttpDataSources() { this.httpDataSources = await this.api("/settings/http-data-sources"); },
    openHttpDataSource(source = null) {
      this.httpDataSourceForm = source ? { ...source, authConfig: { ...source.authConfig }, headersText: JSON.stringify(source.headers || {}, null, 2) } : { id: null, name: "", key: "", baseUrl: "https://", method: "GET", authType: "none", authConfig: { secretRef: "", headerName: "x-api-key", signatureHeader: "x-signature", timestampHeader: "x-timestamp", algorithm: "sha256" }, headersText: "{}", markets: ["A Share"], capabilities: ["bars"], adapterScript: "function adapt(payload) {\n  return (payload.data || []).map(item => ({\n    date: item.date, open: Number(item.open), high: Number(item.high),\n    low: Number(item.low), close: Number(item.close), volume: Number(item.volume || 0)\n  }));\n}" };
      this.dataSourceTestMessage = ""; this.dataSourceDrawerOpen = true;
    },
    httpDataSourcePayload() { return { ...this.httpDataSourceForm, headers: JSON.parse(this.httpDataSourceForm.headersText || "{}") }; },
    async saveHttpDataSource() {
      try { const body = this.httpDataSourcePayload(); await this.api(body.id ? `/settings/http-data-sources/${body.id}` : "/settings/http-data-sources", { method: body.id ? "PUT" : "POST", body: JSON.stringify(body) }); this.dataSourceDrawerOpen = false; await this.loadHttpDataSources(); } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    },
    async testHttpDataSource() {
      this.dataSourceTesting = true; this.dataSourceTestMessage = "";
      try { const result = await this.api("/data-sources/test", { method: "POST", body: JSON.stringify(this.httpDataSourcePayload()) }); this.dataSourceTestMessage = result.message; } catch (error) { this.dataSourceTestMessage = error instanceof Error ? error.message : String(error); } finally { this.dataSourceTesting = false; }
    },
    async removeHttpDataSource(source) { await this.api(`/settings/http-data-sources/${source.id}`, { method: "DELETE" }); await this.loadHttpDataSources(); },
    async loadModelSettings() {
      this.modelConfigs = await this.api("/settings/models");
      this.modelSettings = this.modelConfigs.find((item) => item.isDefault) ?? this.modelConfigs[0] ?? await this.api("/settings/model");
      this.chatForm.modelConfigId ||= this.modelSettings.id || "";
      this.taskForm.modelConfigId ||= this.modelSettings.id || "";
      if (!this.chatForm.model) this.chatForm.model = this.modelSettings.model;
      await this.loadAvailableModels();
      await this.loadSystemPrivateModels();
    },
    async loadSystemPrivateModels() {
      try {
        const payload = await this.api("/settings/system-private-models");
        this.systemPrivateModels = Array.isArray(payload.models) ? payload.models : [];
        this.systemOllamaBaseUrl = payload.baseUrl || this.systemOllamaBaseUrl;
      } catch {
        this.systemPrivateModels = [];
      }
    },
    async setSystemPrivateModelEnabled(model, enabled) {
      try {
        await this.api(`/settings/system-private-models/${encodeURIComponent(model.model)}/enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
        model.enabled = enabled;
        await this.loadAvailableModels();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async savePrivateModelEndpoint(model) {
      try {
        const payload = await this.api(`/settings/system-private-models/${encodeURIComponent(model.model)}/config`, { method: "PUT", body: JSON.stringify({ baseUrl: model.baseUrl }) });
        model.baseUrl = payload.baseUrl;
        this.settingsMessage = `${model.model} 的服务地址已更新。`;
        await this.loadModelSettings();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    formatModelSize(bytes) { return bytes ? `${(Number(bytes) / 1024 / 1024 / 1024).toFixed(1)} GB` : "—"; },
    async loadModelMonitoring() {
      this.monitoringLoading = true;
      try {
        this.modelMonitoring = await this.api(`/monitoring/models?range=${this.monitoringRange}&scope=${this.monitoringScope}`);
        if (this.modelMonitoring.scope !== this.monitoringScope) this.monitoringScope = this.modelMonitoring.scope;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally { this.monitoringLoading = false; }
    },
    formatTokenCount(value) {
      const number = Number(value || 0);
      return number >= 1_000_000 ? `${(number / 1_000_000).toFixed(2)}M` : number >= 1_000 ? `${(number / 1_000).toFixed(1)}K` : String(number);
    },
    monitoringBarWidth(value, items, key) {
      const max = Math.max(1, ...(items || []).map((item) => Number(item[key] || 0)));
      return `${Math.max(3, Number(value || 0) / max * 100)}%`;
    },
    async loadAvailableModels() {
      const selectedConfig = this.modelConfigs.find((item) => item.id === Number(this.chatForm.modelConfigId)) ?? this.modelSettings;
      const configs = this.modelConfigs.length ? this.modelConfigs : [selectedConfig].filter(Boolean);
      const choicesByConfig = await Promise.all(configs.map(async (config) => {
        try {
          const query = config.id ? `?modelConfigId=${config.id}` : "";
          const payload = await this.api(`/settings/model/available${query}`);
          const models = [...new Set([config.model, ...(Array.isArray(payload.models) ? payload.models : [])].filter(Boolean))];
          return models.map((model) => ({
            value: `${config.id || ""}::${model}`,
            label: config.name && config.name !== model ? `${config.name} · ${model}` : model,
            provider: this.modelProviderLabel(config.provider),
            dedupeKey: `${config.provider || "ollama"}::${String(config.baseUrl || "").replace(/\/$/, "")}::${model}`,
            isConfiguredModel: model === config.model,
          }));
        } catch {
          return config.model ? [{
            value: `${config.id || ""}::${config.model}`,
            label: config.name && config.name !== config.model ? `${config.name} · ${config.model}` : config.model,
            provider: this.modelProviderLabel(config.provider),
            dedupeKey: `${config.provider || "ollama"}::${String(config.baseUrl || "").replace(/\/$/, "")}::${config.model}`,
            isConfiguredModel: true,
          }] : [];
        }
      }));
      const uniqueChoices = new Map();
      for (const choice of choicesByConfig.flat().sort((left, right) => Number(right.isConfiguredModel) - Number(left.isConfiguredModel))) {
        if (!uniqueChoices.has(choice.dedupeKey)) uniqueChoices.set(choice.dedupeKey, choice);
      }
      this.chatModelChoices = [...uniqueChoices.values()];
      this.availableModels = this.chatModelChoices
        .filter((item) => item.value.startsWith(`${selectedConfig?.id || ""}::`))
        .map((item) => item.value.slice(item.value.indexOf("::") + 2));
      if (!this.chatModelChoices.some((item) => item.value === this.chatModelSelection)) {
        const selectedDedupeKey = `${selectedConfig?.provider || "ollama"}::${String(selectedConfig?.baseUrl || "").replace(/\/$/, "")}::${this.chatForm.model || selectedConfig?.model || ""}`;
        const fallback = this.chatModelChoices.find((item) => item.dedupeKey === selectedDedupeKey) ?? this.chatModelChoices.find((item) => item.isConfiguredModel) ?? this.chatModelChoices[0];
        if (fallback) this.chatModelSelection = fallback.value;
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
      const subscriptions = await this.api("/subscriptions");
      const savedOrder = JSON.parse(localStorage.getItem("stock-harness-subscription-order") || "{}");
      const marketOrder = ["A Share", "Hong Kong", "US"];
      this.subscriptions = marketOrder.flatMap((market) => {
        const order = (savedOrder[market] ?? []).map(Number);
        const ranks = new Map(order.map((id, index) => [id, index]));
        return subscriptions
          .filter((item) => item.market === market)
          .sort((left, right) => (ranks.get(Number(left.id)) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(Number(right.id)) ?? Number.MAX_SAFE_INTEGER));
      });
      for (const item of this.subscriptions) this.subscriptionChartSettings[item.id] ||= { range: "month", interval: "1d" };
      await this.refreshDashboardCharts();
    },
    async testTushareConnection() {
      this.dataSourceTesting = true;
      this.dataSourceTestMessage = "";
      try {
        const result = await this.api("/settings/data-source/test-tushare", {
          method: "POST", body: JSON.stringify({ tushareToken: this.dataSourceSettings.tushareToken || "" }),
        });
        this.dataSourceTestMessage = result.message;
      } catch (error) {
        this.dataSourceTestMessage = error instanceof Error ? error.message : String(error);
      } finally {
        this.dataSourceTesting = false;
      }
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
        this.modelDrawerOpen = false;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.settingsSaving = false;
      }
    },
    newModelConfig() {
      this.modelSettings = { id: null, name: "OpenAI GPT", provider: "openai", model: "gpt-5-mini", baseUrl: "https://api.openai.com/v1", apiKeyRef: "", apiKey: "", temperature: 0.2, maxOutputTokens: 4096, contextBudgetTokens: 32768, reasoningEffort: "medium", isDefault: !this.modelConfigs.length };
      this.modelTestMessage = "";
      this.modelDrawerOpen = true;
    },
    applyModelProviderDefaults() {
      const presets = {
        ollama: { name: "本地模型", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434", apiKeyRef: "", apiKey: "" },
        openai: { name: "OpenAI GPT", model: "gpt-5-mini", baseUrl: "https://api.openai.com/v1", apiKeyRef: "", apiKey: "" },
        glm: { name: "智谱 GLM", model: "glm-4.5", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKeyRef: "", apiKey: "" },
        minimax: { name: "MiniMax", model: "MiniMax-M1", baseUrl: "https://api.minimaxi.com/v1", apiKeyRef: "", apiKey: "" },
      };
      Object.assign(this.modelSettings, presets[this.modelSettings.provider] || presets.openai);
    },
    modelProviderLabel(provider) { return { ollama: "Ollama", openai: "OpenAI / 兼容 API", glm: "智谱 GLM", minimax: "MiniMax" }[provider] || provider; },
    modelDeploymentLabel(config) { return config.provider === "ollama" ? "平台私有" : "在线 API"; },
    editModelConfig(config) { this.modelSettings = { ...config, apiKey: "" }; this.modelTestMessage = ""; this.modelDrawerOpen = true; },
    async deleteModelConfig(config) {
      if (!confirm(`删除模型配置“${config.name}”？`)) return;
      await this.api(`/settings/models/${config.id}`, { method: "DELETE" });
      await this.loadModelSettings();
    },
    async selectChatModelConfig() {
      const config = this.modelConfigs.find((item) => item.id === Number(this.chatForm.modelConfigId));
      if (config) this.chatForm.model = config.model;
      await this.loadAvailableModels();
    },
    async testModelConnection() {
      this.modelTesting = true;
      this.modelTestMessage = "";
      this.error = "";
      try {
        const payload = await this.api("/settings/models/test-connection", {
          method: "POST",
          body: JSON.stringify(this.modelSettings),
        });
        this.modelTestMessage = payload.message ?? "模型连接测试完成。";
        await this.loadModelSettings();
      } catch (error) {
        this.modelTestMessage = error instanceof Error ? error.message : String(error);
      } finally {
        this.modelTesting = false;
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
    openBindingDrawer(strategy) {
      const bindings = this.strategyBindings(strategy.id);
      const firstBinding = bindings[0];
      this.bindingForm.strategyId = strategy.id;
      this.bindingForm.subscriptionIds = bindings.map((binding) => binding.subscriptionId);
      this.bindingForm.scope = this.subscriptions.length > 0 && bindings.length === this.subscriptions.length ? "all" : "selected";
      if (firstBinding) {
        this.bindingForm.activeSessions = [...firstBinding.activeSessions];
        if (firstBinding.periodMinutes % 60 === 0) {
          this.bindingPeriodValue = firstBinding.periodMinutes / 60;
          this.bindingPeriodUnit = "hours";
        } else {
          this.bindingPeriodValue = firstBinding.periodMinutes;
          this.bindingPeriodUnit = "minutes";
        }
      }
      this.isBindingDrawerOpen = true;
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
    async toggleLabelStrategy(strategy, enabled) {
      try {
        await this.api(`/label-strategies/${strategy.id}`, { method: "PATCH", body: JSON.stringify({ enabled }) });
        await this.loadLabelStrategies();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async bindLabelStrategy() {
      this.error = "";
      try {
        const multiplier = this.bindingPeriodUnit === "hours" ? 60 : 1;
        const periodMinutes = Number(this.bindingPeriodValue) * multiplier;
        const payload = await this.api("/label-strategies/bindings", {
          method: "POST",
          body: JSON.stringify({ ...this.bindingForm, periodMinutes }),
        });
        await this.loadLabelBindings();
        this.labelStrategyMessage = payload.scope === "all"
          ? `策略已应用到全部 ${payload.count} 只订阅股票。`
          : `策略已应用到选择的 ${payload.count} 只订阅股票。`;
        this.isBindingDrawerOpen = false;
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
    strategyBindings(strategyId) {
      return this.labelBindings.filter((binding) => binding.strategyId === strategyId);
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
    async searchSubscriptionSymbols(market, keyword) {
      const payload = await this.api("/symbols/lookup", { method: "POST", body: JSON.stringify({ market, keyword, limit: 12 }) });
      return payload.symbols ?? [];
    },
    async addSubscriptionBatch(items) {
      if (!items.length || this.subscriptionBatchLoading) return;
      this.subscriptionBatchLoading = true;
      this.error = "";
      try {
        for (const item of items) await this.api("/subscriptions", { method: "POST", body: JSON.stringify(item) });
        this.subscriptionDrawerOpen = false;
        await this.loadSubscriptions();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.subscriptionBatchLoading = false;
      }
    },
    startSubscriptionDrag(id, event) {
      this.draggedSubscriptionId = id;
      this.draggedOverSubscriptionId = null;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(id));
    },
    endSubscriptionDrag() {
      this.draggedSubscriptionId = null;
      this.draggedOverSubscriptionId = null;
    },
    leaveSubscriptionDrop(id, event) {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (this.draggedOverSubscriptionId === id) this.draggedOverSubscriptionId = null;
    },
    async dropSubscription(targetId, market, event) {
      const transferredId = Number(event?.dataTransfer?.getData("text/plain") || 0);
      const draggedId = this.draggedSubscriptionId || transferredId;
      this.draggedSubscriptionId = null;
      this.draggedOverSubscriptionId = null;
      if (!draggedId || draggedId === targetId) return;
      const marketItems = this.subscriptions.filter((item) => item.market === market);
      const fromIndex = marketItems.findIndex((item) => item.id === draggedId);
      const toIndex = marketItems.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = marketItems.splice(fromIndex, 1);
      marketItems.splice(toIndex, 0, moved);
      const reordered = new Map(marketItems.map((item) => [Number(item.id), item]));
      const queue = marketItems.map((item) => reordered.get(Number(item.id)));
      this.subscriptions = this.subscriptions.map((item) => item.market === market ? queue.shift() : item);
      const savedOrder = JSON.parse(localStorage.getItem("stock-harness-subscription-order") || "{}");
      savedOrder[market] = marketItems.map((item) => Number(item.id));
      localStorage.setItem("stock-harness-subscription-order", JSON.stringify(savedOrder));
      await nextTick();
      this.renderDashboardCharts();
    },
    setDashboardView(mode) {
      this.dashboardViewMode = mode;
      localStorage.setItem("stock-harness-dashboard-view", mode);
      if (mode === "cards") nextTick(() => this.renderDashboardCharts());
    },
    setDashboardColumns(columns) {
      this.dashboardColumns = columns;
      localStorage.setItem("stock-harness-dashboard-columns", String(columns));
      nextTick(() => this.renderDashboardCharts());
    },
    chartSettingFor(id) {
      return this.subscriptionChartSettings[id] ?? { range: "month", interval: "1d" };
    },
    marketOverviewMetrics(id) {
      const stats = this.marketStats[id];
      if (!stats) return [];
      return [
        { key: "52_week_high", label: "52 周最高", display: stats.high.toFixed(2), tone: "high" },
        { key: "52_week_low", label: "52 周最低", display: stats.low.toFixed(2), tone: "low" },
      ];
    },
    async updateSubscriptionChartSetting(item, key, value) {
      const setting = { ...this.chartSettingFor(item.id), [key]: value };
      this.subscriptionChartSettings[item.id] = setting;
      localStorage.setItem("stock-harness-chart-settings", JSON.stringify(this.subscriptionChartSettings));
      await this.refreshSubscriptionChart(item);
    },
    async refreshSubscriptionChart(item) {
      const setting = this.chartSettingFor(item.id);
      this.chartLoadingIds = [...new Set([...this.chartLoadingIds, item.id])];
      this.chartErrors[item.id] = "";
      try {
        const payload = await this.api("/bars", {
          method: "POST",
          body: JSON.stringify({ market: item.market, symbol: item.symbol, start: startForRange(setting.range), end: isoDate(), adjust: "qfq", interval: setting.interval, range: setting.range }),
        });
        this.chartData[item.id] = payload.bars;
      } catch (error) {
        this.chartErrors[item.id] = error instanceof Error ? error.message : String(error);
      } finally {
        this.chartLoadingIds = this.chartLoadingIds.filter((id) => id !== item.id);
      }
      await nextTick();
      this.renderDashboardCharts();
    },
    async refreshDashboardCharts() {
      this.error = "";
      this.chartErrors = {};
      this.fundamentalErrors = {};
      if (!this.subscriptions.length) {
        disposeDashboardCharts();
        this.chartData = {};
        this.marketStats = {};
        this.fundamentalData = {};
        return;
      }
      this.dashboardLoading = true;
      const nextData = {};
      const nextErrors = {};
      const nextFundamentals = {};
      const nextFundamentalErrors = {};
      const nextMarketStats = {};
      await Promise.all(
        this.subscriptions.map(async (item) => {
          const setting = this.chartSettingFor(item.id);
          await Promise.all([
            (async () => {
              try {
                const payload = await this.api("/bars", {
                  method: "POST",
                  body: JSON.stringify({
                    market: item.market,
                    symbol: item.symbol,
                    start: startForRange(setting.range),
                    end: isoDate(),
                    adjust: "qfq",
                    interval: setting.interval,
                    range: setting.range,
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
            (async () => {
              try {
                const payload = await this.api("/bars", {
                  method: "POST",
                  body: JSON.stringify({ market: item.market, symbol: item.symbol, start: isoDate(370), end: isoDate(), adjust: "qfq", interval: "1d", range: "year" }),
                });
                const bars = payload.bars ?? [];
                const highs = bars.map((bar) => Number(bar.high)).filter(Number.isFinite);
                const lows = bars.map((bar) => Number(bar.low)).filter(Number.isFinite);
                if (highs.length && lows.length) nextMarketStats[item.id] = { high: Math.max(...highs), low: Math.min(...lows) };
              } catch {
                // 行情统计是补充信息，失败时不影响基本面和主图加载。
              }
            })(),
          ]);
        }),
      );
      this.chartData = nextData;
      this.chartErrors = nextErrors;
      this.fundamentalData = nextFundamentals;
      this.fundamentalErrors = nextFundamentalErrors;
      this.marketStats = nextMarketStats;
      this.dashboardLoading = false;
      await nextTick();
      this.renderDashboardCharts();
      await this.refreshCurrentPrices(true);
    },
    async refreshCurrentPrices(force = false) {
      const targets = this.subscriptions.filter((item) => force || isMarketTradingNow(item.market));
      if (!targets.length) return;
      const updates = {};
      await Promise.all(targets.map(async (item) => {
        try {
          const payload = await this.api("/bars", { method: "POST", body: JSON.stringify({ market: item.market, symbol: item.symbol, start: isoDate(2), end: isoDate(), adjust: "qfq", interval: "1m", range: "day" }) });
          const bar = (payload.bars ?? []).at(-1);
          if (bar && Number.isFinite(Number(bar.close))) updates[item.id] = { price: Number(bar.close), time: bar.date || new Date().toISOString(), live: isMarketTradingNow(item.market) };
        } catch {
          const fallback = (this.chartData[item.id] ?? []).at(-1);
          if (force && fallback && Number.isFinite(Number(fallback.close))) updates[item.id] = { price: Number(fallback.close), time: fallback.date, live: false };
        }
      }));
      this.currentPrices = { ...this.currentPrices, ...updates };
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
        const colors = this.marketColorStyle(item.market);
        chart.setStyles({
          ...chartThemeStyles(),
          candle: { bar: {
            upColor: colors.upColor, downColor: colors.downColor, noChangeColor: "#94a3b8",
            upBorderColor: colors.upColor, downBorderColor: colors.downColor, noChangeBorderColor: "#94a3b8",
            upWickColor: colors.upColor, downWickColor: colors.downColor, noChangeWickColor: "#94a3b8",
          }, ...chartThemeStyles().candle },
          indicator: {
            bars: [{ upColor: colors.upColor, downColor: colors.downColor, noChangeColor: "#94a3b8" }],
            lines: [{ color: "#f4b740" }, { color: "#5b8ff9" }, { color: "#9b7bff" }],
          },
        });
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
        chart.createIndicator({ name: "VOL", shortName: "成交量" }, false, { height: 92, minHeight: 72, dragEnabled: true });
        const resizeObserver = new ResizeObserver(() => chart.resize());
        resizeObserver.observe(node);
        dashboardCharts.set(item.id, { chart, resizeObserver });
      }
    },
    async loadRoles() {
      this.roles = await this.api("/agent-roles");
    },
    async loadProjects() {
      this.projects = await this.api("/pi/projects");
      if (this.activeProjectId && !this.projects.some((item) => item.id === this.activeProjectId && !item.archived_at)) this.activeProjectId = null;
      if (!this.expandedProjectIds.length) this.expandedProjectIds = [0, ...this.projects.filter((item) => !item.archived_at).map((item) => item.id)];
    },
    editProject(project) {
      this.projectForm = { id: project.id, name: project.name, description: project.description || "", instructions: project.instructions || "", roleIds: [...(project.roleIds || [])], skillIds: [...(project.skillIds || [])], pluginIds: [...(project.pluginIds || [])] };
      this.selectedProject = project;
      this.projectDialogMode = "edit";
    },
    resetProjectForm() {
      this.projectForm = { id: null, name: "", description: "", instructions: "", roleIds: [], skillIds: [], pluginIds: [] };
      this.selectedProject = null;
      this.projectDialogMode = null;
    },
    createProject() {
      this.resetProjectForm();
      this.projectDialogMode = "create";
    },
    viewProject(project) {
      this.selectedProject = project;
      this.projectDialogMode = "detail";
    },
    projectRoleNames(project) {
      return this.roles.filter((item) => (project.roleIds || []).includes(item.id)).map((item) => item.name);
    },
    projectSkillNames(project) {
      return this.skills.filter((item) => (project.skillIds || []).includes(item.id)).map((item) => item.name);
    },
    projectPluginNames(project) {
      return this.plugins.filter((item) => (project.pluginIds || []).includes(item.id)).map((item) => item.name);
    },
    toggleProjectId(field, id) {
      const list = this.projectForm[field];
      const index = list.indexOf(id);
      if (index >= 0) list.splice(index, 1); else list.push(id);
    },
    async saveProject() {
      if (!this.projectForm.name.trim()) { this.error = "请输入项目名称。"; return; }
      this.projectSaving = true;
      this.error = "";
      try {
        const id = this.projectForm.id;
        const saved = await this.api(id ? `/pi/projects/${id}` : "/pi/projects", { method: id ? "PUT" : "POST", body: JSON.stringify(this.projectForm) });
        await this.loadProjects();
        this.selectProject(saved.id);
        this.resetProjectForm();
        this.settingsMessage = `项目“${saved.name}”已保存。`;
      } catch (error) {
        this.error = error instanceof Error && error.message === "Failed to fetch" ? "无法连接 Node API，请确认本地服务已启动。" : (error instanceof Error ? error.message : String(error));
      } finally {
        this.projectSaving = false;
      }
    },
    async removeProject(project) {
      if (!window.confirm(`删除项目“${project.name}”？项目内历史任务会保留为未归属任务。`)) return;
      await this.api(`/pi/projects/${project.id}`, { method: "DELETE" });
      if (this.activeProjectId === project.id) this.selectProject(null);
      await this.loadProjects();
    },
    async archiveProject(project) {
      if (!window.confirm(`归档项目“${project.name}”？项目数据会保留，之后可以恢复。`)) return;
      await this.api(`/pi/projects/${project.id}/archive`, { method: "POST" });
      if (this.activeProjectId === project.id) this.selectProject(null);
      await this.loadProjects();
    },
    async restoreProject(project) {
      await this.api(`/pi/projects/${project.id}/restore`, { method: "POST" });
      await this.loadProjects();
      this.projectStatusView = "active";
    },
    selectProject(projectId) {
      this.activeProjectId = projectId ? Number(projectId) : null;
      if (this.activeProjectId) localStorage.setItem("stock-harness-active-project", String(this.activeProjectId));
      else localStorage.removeItem("stock-harness-active-project");
      this.chatForm.roleId = "";
      this.newChatSession(false);
      this.syncChatRoute();
    },
    toggleProjectFolder(projectId) {
      const key = projectId ? Number(projectId) : 0;
      const index = this.expandedProjectIds.indexOf(key);
      if (index >= 0) this.expandedProjectIds.splice(index, 1); else this.expandedProjectIds.push(key);
      localStorage.setItem("stock-harness-expanded-projects", JSON.stringify(this.expandedProjectIds));
    },
    isProjectExpanded(projectId) {
      return this.expandedProjectIds.includes(projectId ? Number(projectId) : 0);
    },
    newChatInProject(projectId) {
      this.selectProject(projectId);
      const key = projectId ? Number(projectId) : 0;
      if (!this.expandedProjectIds.includes(key)) this.expandedProjectIds.push(key);
      localStorage.setItem("stock-harness-expanded-projects", JSON.stringify(this.expandedProjectIds));
      nextTick(() => this.$refs.chatComposer?.focus());
    },
    async openProject(project) {
      this.resetProjectForm();
      await this.setModule("pi-chat");
      this.selectProject(project.id);
    },
    openProjectTasks(project) {
      this.activeProjectId = Number(project.id);
      localStorage.setItem("stock-harness-active-project", String(project.id));
      this.taskProjectFilterId = Number(project.id);
      this.resetProjectForm();
      this.setModule("pi-tasks");
    },
    openTaskCreator(project) {
      const projectId = Number(project.id);
      if (this.activeProjectId !== projectId) {
        this.activeProjectId = projectId;
        localStorage.setItem("stock-harness-active-project", String(projectId));
      }
      this.taskDrawerOpen = true;
      nextTick(() => this.$refs.taskComposer?.focus());
    },
    projectTaskCount(projectId) {
      return this.savedTasks.filter((item) => Number(item.projectId) === Number(projectId)).length;
    },
    async loadChatHistory() {
      const conversations = await this.api("/pi/conversations");
      this.chatHistory = conversations.map((item) => ({
        id: item.id,
        title: item.title || "新任务",
        updatedAt: item.updated_at,
        archivedAt: item.archived_at || null,
        projectId: item.project_id ?? null,
        messages: item.messages || [],
      }));
      localStorage.setItem("stock-harness-chat-history", JSON.stringify(this.chatHistory));
    },
    saveTask() {
      if (!this.activeProjectId) { this.error = "请先进入一个项目，再创建定时任务。"; return; }
      if (!this.taskForm.name || !this.taskForm.prompt || !this.taskForm.modelConfigId) { this.error = "请填写任务名称、提示词并选择执行模型。"; return; }
      const model = this.modelConfigs.find((item) => item.id === Number(this.taskForm.modelConfigId));
      const task = { ...this.taskForm, projectId: this.activeProjectId, id: Date.now(), modelName: model?.name ?? model?.model ?? "" };
      this.savedTasks.unshift(task);
      localStorage.setItem("stock-harness-pi-tasks", JSON.stringify(this.savedTasks));
      this.settingsMessage = `定时任务“${task.name}”已保存。`;
      this.taskDrawerOpen = false;
    },
    deleteTask(id) {
      this.savedTasks = this.savedTasks.filter((item) => item.id !== id);
      localStorage.setItem("stock-harness-pi-tasks", JSON.stringify(this.savedTasks));
    },
    taskScheduleLabel(schedule) {
      return ({ manual: "手动（旧任务）", daily: "每日执行", weekly: "每周执行" })[schedule] || schedule;
    },
    newChatSession(syncRoute = true) {
      if (this.chatRecoveryTimer) clearTimeout(this.chatRecoveryTimer);
      this.chatRecoveryTimer = null;
      this.chatSessionId = null;
      this.chatMessages = [];
      this.chatReply = "";
      this.chatThinking = "";
      this.chatTrace = null;
      this.chatAttachments = [];
      this.error = "";
      if (syncRoute) this.syncChatRoute();
    },
    persistArtifacts() {
      localStorage.setItem("stock-harness-project-artifacts", JSON.stringify(this.projectArtifacts));
    },
    artifactTypeIcon(type) {
      return ({ markdown: "M↓", code: "</>", table: "▦", chart: "⌁" })[type] || "文";
    },
    saveMessageAsArtifact(item) {
      if (!this.activeProjectId) { this.error = "正式产物需要归属项目，请先进入一个项目。"; return; }
      const plain = String(item.content || "").replace(/[#*`>]/g, "").trim();
      const title = (plain.split(/\r?\n/).find(Boolean) || "对话研究产物").slice(0, 36);
      const now = new Date().toISOString();
      const artifact = {
        id: Date.now(),
        projectId: this.activeProjectId,
        conversationId: this.chatSessionId,
        title,
        type: "markdown",
        content: item.content || "",
        createdAt: now,
        updatedAt: now,
      };
      this.projectArtifacts.unshift(artifact);
      this.persistArtifacts();
      this.openArtifact(artifact);
      this.settingsMessage = `已保存到项目产物：${title}`;
    },
    openArtifact(artifact) {
      this.selectedArtifactId = artifact.id;
      this.artifactDraft = artifact.content || "";
      this.artifactEditing = false;
      this.artifactWorkspaceOpen = true;
    },
    closeArtifactWorkspace() {
      this.artifactWorkspaceOpen = false;
      this.artifactEditing = false;
    },
    saveArtifactDraft() {
      const artifact = this.selectedArtifact;
      if (!artifact) return;
      artifact.content = this.artifactDraft;
      artifact.updatedAt = new Date().toISOString();
      this.persistArtifacts();
      this.artifactEditing = false;
      this.settingsMessage = `产物“${artifact.title}”已保存。`;
    },
    downloadArtifact(artifact) {
      if (!artifact) return;
      const extension = artifact.type === "markdown" ? "md" : artifact.type === "code" ? "txt" : "txt";
      const blob = new Blob([artifact.content || ""], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${artifact.title.replace(/[\\/:*?\"<>|]/g, "-")}.${extension}`;
      link.click();
      URL.revokeObjectURL(url);
    },
    archiveCurrentChat() {
      if (!this.chatMessages.length) return;
      const first = this.chatMessages.find((item) => item.role === "user")?.content || "新任务";
      const entry = {
        id: this.chatSessionId || Date.now(),
        title: first.slice(0, 28),
        updatedAt: new Date().toISOString(),
        projectId: this.activeProjectId,
        messages: this.chatMessages,
      };
      this.chatHistory = [entry, ...this.chatHistory.filter((item) => item.id !== entry.id)].slice(0, 30);
      localStorage.setItem("stock-harness-chat-history", JSON.stringify(this.chatHistory));
    },
    openChatHistory(entry, syncRoute = true) {
      this.activeProjectId = entry.projectId ?? null;
      if (this.activeProjectId) localStorage.setItem("stock-harness-active-project", String(this.activeProjectId));
      else localStorage.removeItem("stock-harness-active-project");
      this.chatSessionId = entry.id;
      this.chatMessages = entry.messages || [];
      this.chatReply = "";
      this.chatThinking = "";
      if (syncRoute) this.syncChatRoute();
    },
    async renameChat(entry) {
      const title = window.prompt("重命名任务", entry.title);
      if (title === null || !title.trim() || title.trim() === entry.title) return;
      try {
        await this.api(`/pi/conversations/${entry.id}`, { method: "PUT", body: JSON.stringify({ title: title.trim() }) });
        await this.loadChatHistory();
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    },
    async setChatArchived(entry, archived) {
      try {
        await this.api(`/pi/conversations/${entry.id}/${archived ? "archive" : "restore"}`, { method: "POST" });
        if (archived && this.chatSessionId === entry.id) this.newChatSession();
        await this.loadChatHistory();
      } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    },
    formatChatTime(value) {
      if (!value) return "";
      const date = new Date(value);
      const today = new Date();
      return date.toDateString() === today.toDateString()
        ? `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
        : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    },
    async recoverChatSession(entry) {
      const lastMessage = entry?.messages?.at(-1);
      if (!entry || lastMessage?.role !== "user") return;
      const conversationId = entry.id;
      try {
        const status = await this.api(`/pi/conversations/${conversationId}/status`);
        if (!status.running || this.chatSessionId !== conversationId) return;
        this.chatLoading = true;
        const poll = async () => {
          if (this.chatSessionId !== conversationId || this.activeModule !== "pi-chat") {
            this.chatLoading = false;
            this.chatRecoveryTimer = null;
            return;
          }
          try {
            const current = await this.api(`/pi/conversations/${conversationId}/status`);
            await this.loadChatHistory();
            const refreshed = this.chatHistory.find((item) => item.id === conversationId);
            if (refreshed) this.openChatHistory(refreshed, false);
            if (current.running) {
              this.chatRecoveryTimer = setTimeout(poll, 1500);
            } else {
              this.chatLoading = false;
              this.chatRecoveryTimer = null;
            }
          } catch (error) {
            this.chatLoading = false;
            this.chatRecoveryTimer = null;
            this.error = error instanceof Error ? error.message : String(error);
          }
        };
        this.chatRecoveryTimer = setTimeout(poll, 500);
      } catch {
        // 后端已重启或任务已经结束时，保留已加载的历史记录即可。
      }
    },
    syncChatRoute(replace = false) {
      if (this.activeModule !== "pi-chat") return;
      const params = {
        projectId: this.activeProjectId ? String(this.activeProjectId) : "my",
        conversationId: this.chatSessionId ? String(this.chatSessionId) : "new",
      };
      if (String(this.$route.params.projectId || "") === params.projectId && String(this.$route.params.conversationId || "") === params.conversationId) return;
      this.$router[replace ? "replace" : "push"]({ name: "pi-chat", params });
    },
    restoreChatRoute() {
      const projectParam = String(this.$route.params.projectId || "my");
      const conversationParam = String(this.$route.params.conversationId || "new");
      const projectValue = projectParam === "my" ? 0 : Number(projectParam);
      const conversationValue = conversationParam === "new" ? 0 : Number(conversationParam);
      const projectId = Number.isInteger(projectValue) && projectValue > 0 ? projectValue : null;
      this.activeProjectId = projectId && this.projects.some((item) => item.id === projectId) ? projectId : null;
      if (this.activeProjectId) localStorage.setItem("stock-harness-active-project", String(this.activeProjectId));
      else localStorage.removeItem("stock-harness-active-project");
      const entry = conversationValue > 0 ? this.chatHistory.find((item) => item.id === conversationValue && (item.projectId ?? null) === this.activeProjectId) : null;
      if (entry) {
        this.openChatHistory(entry, false);
        void this.recoverChatSession(entry);
      }
      else this.newChatSession(false);
    },
    filteredChatHistory() {
      const query = this.chatHistoryQuery.trim().toLowerCase();
      const scoped = this.chatHistory.filter((item) => (item.projectId ?? null) === this.activeProjectId);
      return query ? scoped.filter((item) => item.title.toLowerCase().includes(query)) : scoped;
    },
    chatHistoryForProject(projectId) {
      const normalized = projectId ? Number(projectId) : null;
      const query = this.chatHistoryQuery.trim().toLowerCase();
      const scoped = this.chatHistory.filter((item) => (item.projectId ?? null) === normalized && !item.archivedAt);
      return query ? scoped.filter((item) => item.title.toLowerCase().includes(query)) : scoped;
    },
    archivedChatHistory() {
      const query = this.chatHistoryQuery.trim().toLowerCase();
      const scoped = this.chatHistory.filter((item) => item.archivedAt);
      return query ? scoped.filter((item) => item.title.toLowerCase().includes(query)) : scoped;
    },
    async startChat() {
      if ((!this.chatForm.message.trim() && !this.chatAttachments.length) || this.chatLoading) return;
      this.chatLoading = true;
      this.chatReply = "";
      this.chatThinking = "";
      this.chatTrace = null;
      this.error = "";
      const userMessage = this.chatForm.message.trim() || "请分析我上传的附件。";
      const sentAttachments = [...this.chatAttachments];
      const selectedModel = this.chatForm.model || this.modelSettings.model;
      const selectedConfig = this.modelConfigs.find((item) => item.id === Number(this.chatForm.modelConfigId)) ?? this.modelSettings;
      const selectedRoleId = this.chatForm.roleId ? Number(this.chatForm.roleId) : null;
      this.chatMessages.push({ role: "user", content: userMessage, attachments: sentAttachments.map(({ dataUrl, text, ...item }) => item), roleName: this.chatRoleLabel() });
      this.setComposerText("");
      this.chatAttachments = [];
      this.chatForm.roleId = "";
      try {
        await configurePiRuntimeClient({ ...selectedConfig, model: selectedModel });
        const result = await llmClient.stream(
          {
            messages: [{ role: "user", content: userMessage }],
            sessionId: this.chatSessionId,
            projectId: this.activeProjectId,
            roleId: selectedRoleId,
            jwtToken: this.token,
            model: selectedModel,
            modelConfigId: selectedConfig.id,
            temperature: this.modelSettings.temperature,
            maxTokens: this.modelSettings.maxOutputTokens,
            attachments: sentAttachments,
          },
          (chunk) => {
            if (chunk.meta) {
              this.chatTrace = chunk.meta;
              this.chatSessionId = chunk.meta.sessionId ?? chunk.meta.conversationId;
              this.syncChatRoute(true);
              this.archiveCurrentChat();
            }
            this.chatReply = chunk.fullContent ?? this.chatReply;
            this.chatThinking = chunk.fullThinking ?? this.chatThinking;
          },
        );
        const assistantContent = result.content || this.chatReply;
        const assistantThinking = result.thinking || this.chatThinking;
        if (assistantContent || assistantThinking) {
          this.chatMessages.push({ role: "assistant", content: assistantContent, thinking: assistantThinking, trace: { ...this.chatTrace, input: userMessage, tools: this.chatTrace?.tools || [] }, roleName: this.chatTrace?.role ?? "个人助手" });
        }
        this.chatReply = "";
        this.chatThinking = "";
        this.archiveCurrentChat();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        if (this.chatSessionId) this.archiveCurrentChat();
        else this.chatMessages = this.chatMessages.filter((item) => item.content !== userMessage || item.role !== "user");
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
        this.syncChatRoute(true);
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
      this.$refs.chatComposer?.insertMention({ id: `role:${role.id}`, label: role.name });
    },
    insertStockMention(stock) {
      const label = `#${stock.symbol}${stock.stockName ? `(${stock.stockName})` : ""} `;
      this.$refs.chatComposer?.insertText(label);
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
        if (!value) editor.clear();
        else editor.focus();
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
    messageTrace(item) {
      return item.trace || (item.streaming ? this.chatTrace : null);
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
    resetRoleForm() {
      this.roleForm = { id: null, name: "", avatar: "", responsibility: "", systemPrompt: "", modelConfigId: "" };
    },
    openRoleCreator() {
      this.resetRoleForm();
      this.roleDrawerOpen = true;
    },
    openRoleEditor(role) {
      this.roleForm = {
        id: role.id,
        name: role.name,
        avatar: role.avatar || "",
        responsibility: role.responsibility,
        systemPrompt: role.systemPrompt,
        modelConfigId: role.modelConfigId || "",
      };
      this.roleDrawerOpen = true;
    },
    onRoleAvatarChange(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        this.error = "请选择图片文件";
        return;
      }
      if (file.size > 1024 * 1024) {
        this.error = "头像不能超过 1 MB";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => { this.roleForm.avatar = String(reader.result || ""); };
      reader.onerror = () => { this.error = "头像读取失败"; };
      reader.readAsDataURL(file);
    },
    roleInitials(role) {
      return String(role?.name || "角色").trim().slice(0, 2);
    },
    async saveRole() {
      this.error = "";
      this.roleSaving = true;
      try {
        const id = this.roleForm.id;
        await this.api(id ? `/agent-roles/${id}` : "/agent-roles", { method: id ? "PUT" : "POST", body: JSON.stringify(this.roleForm) });
        await this.loadRoles();
        this.roleDrawerOpen = false;
        this.resetRoleForm();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.roleSaving = false;
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
          body: JSON.stringify({ skillIds: role.skillIds ?? [], pluginIds: role.pluginIds ?? [], modelConfigId: role.modelConfigId || null }),
        });
        await this.loadRoles();
        this.roleCapabilityDrawerOpen = false;
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
        const id = this.skillForm.id;
        await this.api(id ? `/pi/skills/${id}` : "/pi/skills", { method: id ? "PUT" : "POST", body: JSON.stringify(this.skillForm) });
        this.resetSkillForm();
        this.skillUploadSummary = "";
        await this.loadSkills();
        this.skillDrawerOpen = false;
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
      this.pluginDrawerOpen = true;
    },
    editSkill(skill) {
      this.skillView = "mine";
      this.skillForm = { id: skill.id, name: skill.name, description: skill.description, content: skill.content, visibility: skill.visibility, package: null };
      this.skillUploadSummary = skill.packageName ? `${skill.packageName} · 已导入` : "";
      this.skillDrawerOpen = true;
    },
    async previewSkill(skill) {
      this.selectedSkillPreview = skill;
      this.skillPreviewMode = "rendered";
      this.skillPreviewOpen = true;
      this.skillPreviewLoading = true;
      this.skillPreviewFiles = [];
      this.skillPreviewFilePath = null;
      try {
        const payload = await this.api(`/pi/skills/${skill.id}/package`);
        this.skillPreviewFiles = payload.files || [];
        this.skillPreviewEntry = payload.entry || null;
        this.skillPreviewFilePath = payload.entry || payload.files?.[0]?.path || null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.skillPreviewLoading = false;
      }
    },
    skillFileRows(files) {
      const directories = new Set();
      for (const file of files || []) {
        const parts = file.path.split("/");
        for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join("/"));
      }
      return [
        ...[...directories].map((path) => ({ path, name: path.split("/").pop(), depth: path.split("/").length - 1, directory: true })),
        ...(files || []).map((file) => ({ ...file, name: file.path.split("/").pop(), depth: file.path.split("/").length - 1, directory: false })),
      ].sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
    },
    skillFileLanguage(path) {
      return String(path || "").split(".").pop()?.toUpperCase() || "TEXT";
    },
    handleSkillPreviewLink(event) {
      const anchor = event.target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (!href || /^[a-z]+:/i.test(href) || href.startsWith("#")) return;
      const currentDir = String(this.skillPreviewFilePath || "").split("/").slice(0, -1);
      const parts = [...currentDir, ...href.split("#")[0].split("/")];
      const normalized = [];
      for (const part of parts) part === ".." ? normalized.pop() : part !== "." && part && normalized.push(part);
      const target = normalized.join("/");
      if (this.skillPreviewFiles.some((file) => file.path === target)) {
        event.preventDefault();
        this.skillPreviewFilePath = target;
      }
    },
    resetSkillForm() {
      this.skillForm = { id: null, name: "", description: "", content: "", visibility: "private", package: null };
      this.skillUploadSummary = "";
    },
    async copySkill(skill) {
      await this.api(`/pi/skills/${skill.id}/copy`, { method: "POST" });
      this.skillView = "mine";
      await this.loadSkills();
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
        this.pluginDrawerOpen = false;
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
      if (value === "futu") return "Futu OpenD";
      return "按市场主备数据源";
    },
    usesFutuSource() {
      return Object.values(this.dataSourceSettings.providerChains ?? {}).some((items) => items.includes("futu"));
    },
    rangeLabel(range) {
      return { day: "日", week: "周", month: "月", halfYear: "半年", year: "一年", custom: "自定义" }[range] ?? range;
    },
    usesTushareSource() {
      return Object.values(this.dataSourceSettings.providerChains ?? {}).some((items) => items.includes("tushare"));
    },
    intervalLabel(interval) {
      return { "1m": "1 分钟", "15m": "15 分钟", "30m": "30 分钟", "1h": "1 小时", "4h": "4 小时", "1d": "日 K", "1w": "周 K", "1mo": "月 K" }[interval] ?? interval;
    },
    pluginStatusLabel(status) {
      return { draft: "草稿", published: "已发布", offline: "已下线" }[status] ?? status;
    },
    sourceTypeLabel(sourceType) {
      return { manual: "手动", folder: "文件夹", zip: "ZIP", system: "系统" }[sourceType] ?? "手动";
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
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
  },
  template: `
    <div v-if="!token" class="auth-screen">
      <div class="auth-atmosphere" aria-hidden="true">
        <div class="auth-grid"></div>
        <svg class="market-flow market-flow-back" viewBox="0 0 1200 720" preserveAspectRatio="none"><path d="M-40 540 C100 510 142 566 260 502 S430 405 528 446 S690 520 790 380 S960 240 1240 128" /></svg>
        <svg class="market-flow market-flow-front" viewBox="0 0 1200 720" preserveAspectRatio="none"><path d="M-40 612 C108 584 176 632 292 548 S438 492 562 412 S732 456 842 322 S1020 210 1240 278" /></svg>
        <div class="ticker-strip ticker-strip-one"><span>SH 000001</span><b>+0.86%</b><span>HSI</span><b>+1.24%</b><span>NASDAQ</span><b>+0.48%</b></div>
        <div class="ticker-strip ticker-strip-two"><span>ALPHA</span><b>1.72</b><span>MAX DD</span><b>-4.18%</b><span>SHARPE</span><b>2.31</b></div>
      </div>
      <section class="auth-intro">
        <div class="brand-lockup"><span class="brand-symbol"><i></i><i></i><i></i><i></i></span><span>AlphaDock</span></div>
        <div class="auth-eyebrow"><span></span> QUANT INTELLIGENCE WORKSPACE</div>
        <h1>让每一个策略想法，<br /><em>都有数据回答。</em></h1>
        <p>从行情洞察、策略研究到回测验证，在一个本地智能工作台完成你的量化闭环。</p>
        <div class="auth-capabilities"><span>多市场行情</span><span>策略回测</span><span>AI 研究协作</span></div>
      </section>
      <form class="auth-card" @submit.prevent="submitAuth">
        <div class="auth-card-head">
          <span class="auth-card-kicker">ALPHADOCK / ACCESS</span>
          <h2>{{ authMode === "login" ? "欢迎回来" : "创建研究账户" }}</h2>
          <p>{{ authMode === "login" ? "登录你的阿尔法舱，继续今天的研究。" : "开始构建你的本地量化研究空间。" }}</p>
        </div>
        <div class="auth-fields">
          <label><span>用户名</span><input v-model.trim="auth.username" autocomplete="username" placeholder="请输入用户名" /></label>
          <label><span>密码</span><input v-model="auth.password" type="password" autocomplete="current-password" placeholder="请输入密码" /></label>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" v-model="auth.rememberMe" /><span class="checkbox-mark" aria-hidden="true"></span>
          <span>保持登录状态 <small>30 天内免登录</small></span>
        </label>
        <button class="auth-submit" :disabled="authLoading"><span>{{ authLoading ? "处理中..." : (authMode === "login" ? "进入工作台" : "创建账户") }}</span><b>↗</b></button>
        <button class="auth-switch" type="button" @click="authMode = authMode === 'login' ? 'register' : 'login'">{{ authMode === "login" ? "还没有账户？创建一个" : "已有账户？返回登录" }}</button>
        <div v-if="error" class="error">{{ error }}</div>
        <div class="auth-secure"><span>●</span> 本地运行 · 数据由你掌控</div>
      </form>
    </div>

    <AppShell
      v-else
      :active-primary="activePrimary"
      :active-module="activeModule"
      :username="currentUser?.username"
      :theme="appTheme"
      @primary-navigate="setPrimaryModule"
      @module-navigate="navigateModule"
      @theme-change="setAppTheme"
      @logout="logout"
    >
      <main :class="{ 'chat-main': activeModule === 'pi-chat' }">
        <div v-if="error" class="error">{{ error }}</div>

        <section v-if="activeModule === 'dashboard'" class="module-panel">
          <div class="dashboard-view-toolbar">
            <DashboardViewControls :view-mode="dashboardViewMode" :columns="dashboardColumns" @update:view-mode="setDashboardView" @update:columns="setDashboardColumns" />
            <div class="dashboard-toolbar-actions">
              <a-button type="primary" size="small" @click="subscriptionDrawerOpen = true"><template #icon><IconStar /></template>添加订阅</a-button>
              <a-button size="small" :loading="dashboardLoading" @click="refreshDashboardCharts">刷新全部</a-button>
              <a-select v-if="dashboardViewMode === 'cards'" v-model="chartLocale" size="small" @change="renderDashboardCharts"><a-option value="zh-CN">中文</a-option><a-option value="en-US">English</a-option></a-select>
            </div>
          </div>

          <SubscriptionDrawer v-model:visible="subscriptionDrawerOpen" :subscriptions="subscriptions" :search-symbols="searchSubscriptionSymbols" :loading="subscriptionBatchLoading" @confirm="addSubscriptionBatch" />

          <div v-if="dashboardLoading" class="hint dark">正在加载 K 线...</div>
          <div v-if="!subscriptions.length" class="empty-state">还没有订阅股票。</div>

          <template v-if="dashboardViewMode === 'cards'">
          <section v-for="(items, market) in groupedSubscriptions" :key="market" v-show="items.length" class="market-section">
            <h3>{{ marketLabel(market) }}</h3>
            <div class="subscription-grid" :style="{ '--subscription-columns': Math.min(dashboardColumns, items.length) }">
              <article v-for="item in items" :key="item.id" class="subscription-card" :class="{ 'is-dragging': draggedSubscriptionId === item.id, 'is-drag-over': draggedOverSubscriptionId === item.id && draggedSubscriptionId !== item.id }" @dragover.prevent @dragenter.prevent="draggedOverSubscriptionId = item.id" @dragleave="leaveSubscriptionDrop(item.id, $event)" @drop.prevent="dropSubscription(item.id, market, $event)">
                <div class="card-title">
                  <div>
                    <strong class="stock-heading">
                      <span>{{ item.stockName || item.name || marketLabel(item.market) }}</span>
                      <code>{{ item.symbol }}</code>
                    </strong>
                    <span v-if="item.remark" class="stock-remark">{{ item.remark }}</span>
                  </div>
                  <div class="card-actions">
                    <span class="subscription-drag-handle" draggable="true" title="拖动调整顺序" aria-label="拖动调整顺序" @dragstart.stop="startSubscriptionDrag(item.id, $event)" @dragend.stop="endSubscriptionDrag">⠿</span>
                    <a-popconfirm content="确定取消订阅这只股票吗？" ok-text="确定取消" cancel-text="保留" type="warning" @ok="removeSubscription(item.id)">
                      <a-button class="unsubscribe-star" shape="circle" size="small" type="text" title="取消订阅" aria-label="取消订阅"><IconStarFill /></a-button>
                    </a-popconfirm>
                  </div>
                </div>
                <div class="stock-classification">
                  <span>所属板块</span>
                  <strong>{{ fundamentalData[item.id]?.sector || fundamentalData[item.id]?.industry || "暂无" }}</strong>
                  <small v-if="fundamentalData[item.id]?.sector && fundamentalData[item.id]?.industry && fundamentalData[item.id].sector !== fundamentalData[item.id].industry">
                    {{ fundamentalData[item.id].industry }}
                  </small>
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
                    <article v-for="metric in [...fundamentalData[item.id].metrics, ...marketOverviewMetrics(item.id)]" :key="metric.key" :class="{ 'market-stat-high': metric.tone === 'high', 'market-stat-low': metric.tone === 'low' }">
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
                <StockChartControls :setting="chartSettingFor(item.id)" :loading="chartLoadingIds.includes(item.id)" @change="(key, value) => updateSubscriptionChartSetting(item, key, value)" />
                <a-spin class="chart-loading-wrap" :loading="chartLoadingIds.includes(item.id)" tip="正在加载 K 线…">
                  <div v-if="chartErrors[item.id]" class="chart-error">K 线加载失败：{{ chartErrors[item.id] }}</div>
                  <div v-else :id="'subChart-' + item.id" class="mini-chart"></div>
                </a-spin>
              </article>
            </div>
          </section>
          </template>
          <SubscriptionTable v-else :subscriptions="subscriptions" :fundamentals="fundamentalData" :chart-data="chartData" :current-prices="currentPrices" :labels="subscriptionLabels" :strategies="strategies" :market-label="marketLabel" :market-colors="displaySettings.marketColors" @unsubscribe="removeSubscription" />
        </section>

        <section v-if="activeModule === 'label-strategies'" class="module-panel label-strategy-page">
          <div class="panel-head">
            <div><h2>标签策略</h2><p>统一管理标签规则、订阅股票绑定与定时执行。</p></div>
            <a-button type="primary" @click="openStrategyModal">新建策略</a-button>
          </div>

          <a-alert v-if="labelStrategyMessage" type="success" closable>{{ labelStrategyMessage }}</a-alert>
          <a-card class="strategy-table-card" :bordered="true">
            <a-table :data="labelStrategies" :pagination="false" row-key="id" :bordered="false">
              <template #columns>
                <a-table-column title="策略名称" :width="190">
                  <template #cell="{ record }"><div class="strategy-name-cell"><strong>{{ record.name }}</strong><a-tag color="arcoblue">{{ record.targetLabel }}</a-tag></div></template>
                </a-table-column>
                <a-table-column title="规则条件">
                  <template #cell="{ record }"><span class="rule-condition-text">{{ record.conditions.map(c => metricLabel(c.metric) + ' ' + c.op + ' ' + c.value).join('；') }}</span></template>
                </a-table-column>
                <a-table-column title="生效范围" :width="125">
                  <template #cell="{ record }"><a-tag>{{ strategyBindingCount(record.id) === subscriptions.length && subscriptions.length ? '全部订阅' : strategyBindingCount(record.id) + ' 只股票' }}</a-tag></template>
                </a-table-column>
                <a-table-column title="绑定股票" :width="210">
                  <template #cell="{ record }"><div class="bound-symbols"><a-tag v-for="item in strategyBindings(record.id).slice(0, 3)" :key="item.id">{{ item.stockName || '未知股票' }} · {{ item.symbol }}</a-tag><span v-if="strategyBindings(record.id).length > 3">+{{ strategyBindings(record.id).length - 3 }}</span><span v-if="!strategyBindings(record.id).length" class="muted-text">未绑定</span></div></template>
                </a-table-column>
                <a-table-column title="执行间隔" :width="105">
                  <template #cell="{ record }"><span v-if="strategyBindings(record.id)[0]">{{ strategyBindings(record.id)[0].periodMinutes % 60 === 0 ? strategyBindings(record.id)[0].periodMinutes / 60 + ' 小时' : strategyBindings(record.id)[0].periodMinutes + ' 分钟' }}</span><span v-else>-</span></template>
                </a-table-column>
                <a-table-column title="执行开关" :width="95" align="center">
                  <template #cell="{ record }"><a-switch :model-value="record.enabled" size="small" @change="value => toggleLabelStrategy(record, value)" /></template>
                </a-table-column>
                <a-table-column title="操作" :width="260" fixed="right">
                  <template #cell="{ record }"><a-space>
                    <a-button type="text" size="small" @click="openBindingDrawer(record)">绑定股票</a-button>
                    <a-button type="text" size="small" :loading="labelStrategyRunId === record.id" :disabled="!record.enabled || Boolean(labelStrategyRunId)" @click="runLabelStrategy(record)">运行</a-button>
                    <a-popconfirm content="删除后相关绑定也会移除，确定删除吗？" @ok="removeLabelStrategy(record.id)"><a-button type="text" status="danger" size="small">删除</a-button></a-popconfirm>
                  </a-space></template>
                </a-table-column>
              </template>
              <template #empty><a-empty description="暂无标签策略，请先新建" /></template>
            </a-table>
          </a-card>

          <a-drawer v-model:visible="isStrategyModalOpen" title="新建标签策略" :width="640" :footer="false" unmount-on-close>
            <a-form class="strategy-form" layout="vertical" :model="strategyForm" @submit-success="saveLabelStrategy">
              <a-form-item label="策略名称" field="name" :rules="[{ required: true, message: '请输入策略名称' }]"><a-input v-model="strategyForm.name" placeholder="如：高 ROE 现金牛" /></a-form-item>
              <a-form-item label="命中标签" field="targetLabel" :rules="[{ required: true, message: '请输入命中标签' }]"><a-input v-model="strategyForm.targetLabel" placeholder="如：好公司" /></a-form-item>
              <a-form-item label="命中条件">
                <div class="drawer-condition-list">
                  <div v-for="(condition, index) in strategyForm.conditions" :key="index" class="condition-row">
                    <a-select v-model="condition.metric"><a-option v-for="(_, key) in fundamentalMetricLabels" :key="key" :value="key">{{ metricLabel(key) }}</a-option></a-select>
                    <a-select v-model="condition.op"><a-option v-for="op in ['>','>=','<','<=','==','!=']" :key="op" :value="op">{{ op }}</a-option></a-select>
                    <a-input-number v-model="condition.value" :precision="4" />
                    <a-button status="danger" size="small" @click="removeStrategyCondition(index)">删除</a-button>
                  </div>
                  <a-button size="small" @click="addStrategyCondition">新增条件</a-button>
                </div>
              </a-form-item>

              <div class="template-reference-head"><strong>参考系统模板</strong><span>点击模板填充上方表单，模板本身不会生效</span></div>
              <div class="template-reference-row">
                <a-card v-for="template in labelStrategyTemplates" :key="template.key" hoverable size="small" @click="useLabelStrategyTemplate(template)">
                  <strong>{{ template.name }}</strong><a-tag>{{ template.targetLabel }}</a-tag><small>{{ template.description }}</small>
                </a-card>
              </div>
              <div class="drawer-footer"><a-button @click="closeStrategyModal">取消</a-button><a-button type="primary" html-type="submit">创建策略</a-button></div>
            </a-form>
          </a-drawer>

          <a-drawer v-model:visible="isBindingDrawerOpen" title="绑定股票与运行配置" :width="520" :footer="false" unmount-on-close>
            <a-form class="strategy-form" layout="vertical" :model="bindingForm" @submit-success="bindLabelStrategy">
              <a-form-item label="生效范围"><a-radio-group v-model="bindingForm.scope" type="button"><a-radio value="selected">按选择生效</a-radio><a-radio value="all">全部生效</a-radio></a-radio-group></a-form-item>
              <a-form-item v-if="bindingForm.scope === 'selected'" label="订阅股票" field="subscriptionIds" :rules="[{ required: true, type: 'array', minLength: 1, message: '请至少选择一只股票' }]">
                <a-select v-model="bindingForm.subscriptionIds" placeholder="选择股票代码（可多选）" multiple allow-search allow-clear><a-option v-for="item in subscriptions" :key="item.id" :value="item.id">{{ item.symbol }} {{ item.stockName }}</a-option></a-select>
              </a-form-item>
              <a-form-item label="生效时段" field="activeSessions" :rules="[{ required: true, type: 'array', minLength: 1, message: '至少选择一个时段' }]">
                <a-checkbox-group v-model="bindingForm.activeSessions"><a-checkbox value="pre_market">盘前</a-checkbox><a-checkbox value="market">盘中</a-checkbox><a-checkbox value="post_market">盘后</a-checkbox></a-checkbox-group>
              </a-form-item>
              <a-form-item label="定时时间间隔"><div class="period-input-row"><a-input-number v-model="bindingPeriodValue" :min="bindingPeriodUnit === 'hours' ? 1 : 5" :precision="0" /><a-select v-model="bindingPeriodUnit"><a-option value="minutes">分钟</a-option><a-option value="hours">小时</a-option></a-select></div></a-form-item>
              <a-alert type="info">自动任务仅在所属市场交易日和所选时段内，按照配置间隔触发。</a-alert>
              <div class="drawer-footer"><a-button @click="isBindingDrawerOpen = false">取消</a-button><a-button type="primary" html-type="submit">保存绑定配置</a-button></div>
            </a-form>
          </a-drawer>
        </section>

        <section v-if="false && activeModule === 'label-strategies'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>标签策略</h2>
              <p>维护基本面标签规则，并绑定到已订阅股票定期执行。</p>
            </div>
            <a-button type="primary" size="small" @click="openStrategyModal">新增策略</a-button>
          </div>

          <section class="strategy-config-panel label-strategy-layout">
            <div class="strategy-column">
              <div class="section-title-row">
                <div><h3>标签规则</h3><p>用户规则会按应用范围自动执行</p></div>
                <a-tag color="arcoblue">{{ labelStrategies.length }} 条</a-tag>
              </div>
              <div v-if="labelStrategyMessage" class="success">{{ labelStrategyMessage }}</div>
              <div class="strategy-list rule-card-list">
                <a-card v-for="strategy in labelStrategies" :key="strategy.id" size="small" :bordered="true">
                  <div>
                    <strong>{{ strategy.name }}</strong>
                    <a-tag color="arcoblue">{{ strategy.targetLabel }}</a-tag>
                  </div>
                  <small>{{ strategy.conditions.map((c) => metricLabel(c.metric) + ' ' + c.op + ' ' + c.value).join('；') }}</small>
                  <small>已应用 {{ strategyBindingCount(strategy.id) }} 只订阅股票</small>
                  <div class="button-row">
                    <a-button type="primary" size="mini" :loading="labelStrategyRunId === strategy.id" :disabled="Boolean(labelStrategyRunId)" @click="runLabelStrategy(strategy)">
                      {{ labelStrategyRunId === strategy.id ? "执行中..." : "立即执行" }}
                    </a-button>
                    <a-popconfirm content="删除后相关股票绑定也会一起移除，确定删除吗？" @ok="removeLabelStrategy(strategy.id)">
                      <a-button status="danger" size="mini" :disabled="Boolean(labelStrategyRunId)">删除</a-button>
                    </a-popconfirm>
                  </div>
                </a-card>
                <a-empty v-if="!labelStrategies.length" description="还没有用户规则，可以从系统模板复制或新建" />
              </div>

              <div class="section-title-row template-heading">
                <div><h3>系统模板</h3><p>模板仅供查看和复制，本身不会执行</p></div>
                <a-tag color="orange">只读</a-tag>
              </div>
              <div class="template-list template-card-list">
                <a-card v-for="template in labelStrategyTemplates" :key="template.key" size="small" :bordered="true">
                  <div>
                    <strong>{{ template.name }}</strong>
                    <a-tag>{{ template.targetLabel }}</a-tag>
                  </div>
                  <small>{{ template.description }}</small>
                  <small>{{ template.conditions.map((c) => metricLabel(c.metric) + ' ' + c.op + ' ' + c.value).join('；') }}</small>
                  <div class="button-row">
                    <a-button size="mini" @click="useLabelStrategyTemplate(template)">查看并调整</a-button>
                    <a-button type="primary" size="mini" @click="copyLabelStrategyTemplate(template.key)">复制为我的规则</a-button>
                  </div>
                </a-card>
              </div>
            </div>
            <div class="strategy-column">
              <div class="section-title-row">
                <div><h3>应用设置</h3><p>选择规则作用范围与自动执行节奏</p></div>
              </div>
              <a-form class="strategy-form" layout="vertical" :model="bindingForm" @submit-success="bindLabelStrategy">
                <a-form-item label="应用范围">
                  <a-radio-group v-model="bindingForm.scope" type="button">
                    <a-radio value="selected">按选择生效</a-radio><a-radio value="all">全部生效</a-radio>
                  </a-radio-group>
                </a-form-item>
                <a-form-item v-if="bindingForm.scope === 'selected'" label="订阅股票" field="subscriptionIds" :rules="[{ required: true, type: 'array', minLength: 1, message: '请至少选择一只订阅股票' }]">
                  <a-select v-model="bindingForm.subscriptionIds" placeholder="选择股票（可多选）" multiple allow-search allow-clear>
                    <a-option v-for="item in subscriptions" :key="item.id" :value="item.id">{{ item.symbol }} {{ item.stockName }}</a-option>
                  </a-select>
                </a-form-item>
                <a-form-item label="标签规则" field="strategyId" :rules="[{ required: true, message: '请选择标签规则' }]">
                  <a-select v-model="bindingForm.strategyId" placeholder="选择策略">
                    <a-option v-for="strategy in labelStrategies" :key="strategy.id" :value="strategy.id">{{ strategy.name }}</a-option>
                  </a-select>
                </a-form-item>
                <a-form-item label="生效时段" extra="仅在股票交易日的所选时段触发" field="activeSessions" :rules="[{ required: true, type: 'array', minLength: 1, message: '至少选择一个生效时段' }]">
                  <a-checkbox-group v-model="bindingForm.activeSessions">
                    <a-checkbox value="pre_market">盘前</a-checkbox><a-checkbox value="market">盘中</a-checkbox><a-checkbox value="post_market">盘后</a-checkbox>
                  </a-checkbox-group>
                </a-form-item>
                <a-form-item label="触发间隔">
                <div class="period-input-row">
                  <a-input-number v-model="bindingPeriodValue" :min="bindingPeriodUnit === 'hours' ? 1 : 5" :precision="0" />
                  <a-select v-model="bindingPeriodUnit"><a-option value="minutes">分钟</a-option><a-option value="hours">小时</a-option></a-select>
                </div>
                </a-form-item>
                <p class="form-tip">自动任务按股票所属市场时区判断交易日和时段，执行频率按此间隔控制。</p>
                <a-button type="primary" html-type="submit" long>保存应用设置</a-button>
              </a-form>
              <div class="section-title-row binding-heading"><div><h3>已应用规则</h3></div><a-tag>{{ labelBindings.length }}</a-tag></div>
              <div class="strategy-list binding-list">
                <a-card v-for="binding in labelBindings" :key="binding.id" size="small" :bordered="true">
                  <div>
                    <strong>{{ bindingSubscriptionName(binding) }}</strong>
                    <span>{{ binding.strategyName }} · {{ binding.periodMinutes % 60 === 0 ? binding.periodMinutes / 60 + ' 小时' : binding.periodMinutes + ' 分钟' }}</span>
                  </div>
                  <small class="session-summary">{{ (binding.activeSessions || ['market']).map(s => ({pre_market:'盘前', market:'盘中', post_market:'盘后'}[s])).join(' / ') }}生效</small>
                  <small>{{ binding.latestLabel || "未命中" }} · {{ binding.latestReason || "等待执行" }}</small>
                  <div class="button-row">
                    <a-button type="primary" size="mini" @click="runLabelBinding(binding.id)">立即执行</a-button>
                    <a-popconfirm content="确定解除这条应用设置吗？" @ok="removeLabelBinding(binding.id)"><a-button status="danger" size="mini">解绑</a-button></a-popconfirm>
                  </div>
                </a-card>
              </div>
            </div>
          </section>

          <a-modal v-model:visible="isStrategyModalOpen" title="新增标签规则" :footer="false" :width="760" unmount-on-close>
              <p class="modal-description">设置命中标签和基本面条件。</p>
              <a-form class="strategy-form" layout="vertical" :model="strategyForm" @submit-success="saveLabelStrategy">
                <a-form-item label="策略名称" field="name" :rules="[{ required: true, message: '请输入策略名称' }]">
                  <a-input v-model="strategyForm.name" placeholder="如：高 ROE 现金牛" />
                </a-form-item>
                <a-form-item label="命中标签" field="targetLabel" :rules="[{ required: true, message: '请输入命中标签' }]">
                  <a-input v-model="strategyForm.targetLabel" placeholder="如：好公司 / 贵公司" />
                </a-form-item>
                <div class="condition-label">命中条件</div>
                <div v-for="(condition, index) in strategyForm.conditions" :key="index" class="condition-row">
                  <a-select v-model="condition.metric"><a-option v-for="(_, key) in fundamentalMetricLabels" :key="key" :value="key">{{ metricLabel(key) }}</a-option></a-select>
                  <a-select v-model="condition.op"><a-option value=">">&gt;</a-option><a-option value=">=">&gt;=</a-option><a-option value="<">&lt;</a-option><a-option value="<=">&lt;=</a-option><a-option value="==">=</a-option><a-option value="!=">!=</a-option></a-select>
                  <a-input-number v-model="condition.value" :precision="4" />
                  <a-button status="danger" size="small" @click="removeStrategyCondition(index)">删除</a-button>
                </div>
                <div class="modal-actions">
                  <a-button size="small" @click="addStrategyCondition">新增条件</a-button>
                  <div class="button-row">
                    <a-button size="small" @click="closeStrategyModal">取消</a-button>
                    <a-button type="primary" size="small" html-type="submit">保存策略</a-button>
                  </div>
                </div>
              </a-form>
          </a-modal>
        </section>

        <section v-if="activeModule === 'backtest-strategies'" class="module-panel">
          <BacktestStrategyManager :strategies="strategies" :subscriptions="subscriptions" :request="api" :pct="pct" @refresh-strategies="loadStrategies" />
        </section>

        <section v-if="activeModule === 'pi-projects'" class="module-panel project-management">
          <div class="panel-head">
            <div><h2>项目管理</h2><p>统一管理项目，以及每个项目可使用的角色、公共 Skill 和插件。</p></div>
            <a-button type="primary" class="project-create-button" @click="createProject">＋ 新建项目</a-button>
          </div>
          <a-radio-group v-model="projectStatusView" type="button" class="project-status-tabs">
            <a-radio value="active">使用中（{{ activeProjects.length }}）</a-radio>
            <a-radio value="archived">已归档（{{ archivedProjects.length }}）</a-radio>
          </a-radio-group>
          <div class="project-table-card">
            <a-table :columns="projectColumns" :data="displayedProjects" row-key="id" :pagination="false" :scroll="{ x: 1150 }" stripe>
              <template #projectName="{ record: project }"><div class="project-name-cell"><span class="project-table-icon">▱</span><div><strong>{{ project.name }}</strong><a-tag v-if="project.id === activeProjectId" color="green" size="small">当前项目</a-tag></div></div></template>
              <template #description="{ record: project }"><span class="table-description">{{ project.description || '—' }}</span></template>
              <template #roles="{ record: project }">{{ projectRoleNames(project).join('、') || '未配置' }}</template>
              <template #capabilities="{ record: project }"><a-space><a-tag>Skill {{ project.skillIds.length }}</a-tag><a-tag>插件 {{ project.pluginIds.length }}</a-tag></a-space></template>
              <template #updatedAt="{ record: project }">{{ formatTime(project.updated_at) }}</template>
              <template #actions="{ record: project }"><a-space wrap><template v-if="!project.archived_at"><a-button type="text" size="mini" @click="openProject(project)">任务</a-button><a-button type="text" size="mini" @click="openProjectTasks(project)">定时任务</a-button><a-button type="text" size="mini" @click="viewProject(project)">详情</a-button><a-button type="text" size="mini" @click="editProject(project)">修改</a-button><a-button type="text" status="warning" size="mini" @click="archiveProject(project)">归档</a-button></template><template v-else><a-button type="text" size="mini" @click="viewProject(project)">详情</a-button><a-button type="text" size="mini" @click="restoreProject(project)">恢复</a-button><a-button type="text" status="danger" size="mini" @click="removeProject(project)">永久删除</a-button></template></a-space></template>
              <template #empty><a-empty :description="projectStatusView === 'archived' ? '暂无已归档项目' : '还没有项目'"><a-button v-if="projectStatusView === 'active'" type="primary" @click="createProject">新建项目</a-button></a-empty></template>
            </a-table>
          </div>

          <a-modal :visible="Boolean(projectDialogMode)" :footer="false" :width="900" unmount-on-close @cancel="resetProjectForm">
            <section v-if="projectDialogMode === 'detail' && selectedProject" class="project-detail-dialog">
              <div class="modal-head"><div><h3>{{ selectedProject.name }}</h3><p>项目详情与能力配置</p></div></div>
              <div class="project-detail-summary"><div><small>任务</small><strong>{{ selectedProject.conversationCount }}</strong></div><div><small>定时任务</small><strong>{{ projectTaskCount(selectedProject.id) }}</strong></div><div><small>角色</small><strong>{{ selectedProject.roleIds.length }}</strong></div><div><small>Skill / 插件</small><strong>{{ selectedProject.skillIds.length }} / {{ selectedProject.pluginIds.length }}</strong></div></div>
              <dl class="project-detail-list"><div><dt>项目说明</dt><dd>{{ selectedProject.description || '暂无项目说明' }}</dd></div><div><dt>公共指令</dt><dd class="instruction-text">{{ selectedProject.instructions || '暂无公共指令' }}</dd></div><div><dt>角色成员</dt><dd><span v-for="name in projectRoleNames(selectedProject)" :key="name" class="detail-tag">{{ name }}</span><span v-if="!projectRoleNames(selectedProject).length">未配置</span></dd></div><div><dt>公共 Skill</dt><dd><span v-for="name in projectSkillNames(selectedProject)" :key="name" class="detail-tag">{{ name }}</span><span v-if="!projectSkillNames(selectedProject).length">未配置</span></dd></div><div><dt>公共插件</dt><dd><span v-for="name in projectPluginNames(selectedProject)" :key="name" class="detail-tag">{{ name }}</span><span v-if="!projectPluginNames(selectedProject).length">未配置</span></dd></div></dl>
              <div class="modal-actions"><template v-if="!selectedProject.archived_at"><a-button @click="openProject(selectedProject)">进入项目</a-button><a-button type="primary" @click="editProject(selectedProject)">修改配置</a-button></template><a-button v-else type="primary" @click="restoreProject(selectedProject); resetProjectForm()">恢复项目</a-button></div>
            </section>
            <section v-else class="project-editor-dialog">
              <div class="modal-head"><div><h3>{{ projectDialogMode === 'edit' ? '修改项目' : '新建项目' }}</h3><p>{{ projectDialogMode === 'edit' ? '修改项目信息和公共能力配置。' : '创建一个用于组织任务、定时任务和共享能力的项目。' }}</p></div></div>
              <a-form class="project-form arco-project-form" layout="vertical" :model="projectForm" @submit-success="saveProject">
                <a-form-item label="项目名称" field="name" :rules="[{ required: true, message: '请输入项目名称' }]"><a-input v-model="projectForm.name" placeholder="如：贵州茅台研究" allow-clear /></a-form-item>
                <a-form-item label="项目说明"><a-textarea v-model="projectForm.description" placeholder="项目目标、范围和背景" :auto-size="{ minRows: 2, maxRows: 4 }" /></a-form-item>
                <a-form-item label="项目公共指令"><a-textarea v-model="projectForm.instructions" placeholder="所有项目对话都要遵循的约束和输出要求" :auto-size="{ minRows: 2, maxRows: 5 }" /></a-form-item>
                <div class="project-config-columns">
                  <a-card title="角色成员" :bordered="true"><a-checkbox v-for="role in roles" :key="'pr-' + role.id" class="project-check-item" :model-value="projectForm.roleIds.includes(role.id)" @change="toggleProjectId('roleIds', role.id)"><span><strong>{{ role.name }}</strong><small>{{ role.responsibility }}</small></span></a-checkbox><a-empty v-if="!roles.length" description="请先创建角色" /></a-card>
                  <a-card title="公共 Skill" :bordered="true"><a-checkbox v-for="skill in ownedSkills" :key="'ps-' + skill.id" class="project-check-item" :model-value="projectForm.skillIds.includes(skill.id)" @change="toggleProjectId('skillIds', skill.id)"><span>{{ skill.name }}</span></a-checkbox><a-empty v-if="!ownedSkills.length" description="暂无自己的 Skill" /></a-card>
                  <a-card title="公共插件" :bordered="true"><a-checkbox v-for="plugin in publishedPlugins" :key="'pp-' + plugin.id" class="project-check-item" :model-value="projectForm.pluginIds.includes(plugin.id)" @change="toggleProjectId('pluginIds', plugin.id)"><span>{{ plugin.name }}</span></a-checkbox><a-empty v-if="!publishedPlugins.length" description="暂无已发布插件" /></a-card>
                </div>
                <div class="modal-actions"><a-button @click="resetProjectForm">取消</a-button><a-button type="primary" html-type="submit" :loading="projectSaving">{{ projectDialogMode === 'edit' ? '保存修改' : '创建项目' }}</a-button></div>
              </a-form>
            </section>
          </a-modal>
        </section>

        <section v-if="activeModule === 'pi-chat'" class="module-panel">
          <div class="openwebui-shell" :class="{ 'sidebar-hidden': !chatSidebarOpen }">
            <div class="chat-history-sidebar">
              <div class="history-brand"><span class="history-logo">✦</span><strong>Stock AI</strong><a-button type="text" shape="circle" title="收起侧栏" @click="chatSidebarOpen = false">‹</a-button></div>
              <a-button class="history-new" long @click="newChatInProject(activeProjectId)"><span>＋</span> {{ activeProject ? '在' + activeProject.name + '中新建任务' : '新建任务' }}</a-button>
              <a-input v-model="chatHistoryQuery" class="history-search" allow-clear placeholder="搜索任务"><template #prefix>⌕</template></a-input>
              <div class="history-section project-tree">
                <small>项目</small>
                <div v-for="project in activeProjects" :key="project.id" class="project-tree-group">
                  <div class="project-tree-row" :class="{ active: project.id === activeProjectId }">
                    <button class="project-folder" type="button" @click="toggleProjectFolder(project.id)"><span>{{ isProjectExpanded(project.id) ? '⌄' : '›' }}</span><span>▱</span></button>
                    <button class="project-name" type="button" @click="selectProject(project.id)">{{ project.name }}</button>
                    <button class="project-add" type="button" title="在项目中新建任务" @click="newChatInProject(project.id)">＋</button>
                  </div>
                  <div v-if="isProjectExpanded(project.id)" class="project-conversations">
                    <div class="project-task-row" :class="{ active: activeModule === 'pi-tasks' && activeProjectId === project.id }">
                      <button type="button" class="project-submodule" @click="openProjectTasks(project)"><span>◇</span><span>定时任务</span><b>{{ projectTaskCount(project.id) }}</b></button>
                      <button type="button" class="project-task-add" title="新建定时任务" aria-label="新建定时任务" @click.stop="openTaskCreator(project)">＋</button>
                    </div>
                    <div v-for="entry in chatHistoryForProject(project.id)" :key="entry.id" class="conversation-row" :class="{ active: entry.id === chatSessionId }"><button type="button" @click="openChatHistory(entry)"><span></span><span><strong>{{ entry.title }}</strong><small>{{ formatChatTime(entry.updatedAt) }}</small></span></button><a-dropdown trigger="click"><button class="conversation-more" type="button" aria-label="任务操作" @click.stop>···</button><template #content><a-doption @click="renameChat(entry)">重命名</a-doption><a-doption @click="setChatArchived(entry, true)">归档</a-doption></template></a-dropdown></div>
                    <p v-if="!chatHistoryForProject(project.id).length">暂无任务</p>
                  </div>
                </div>
                <div class="project-tree-group personal-group">
                  <div class="project-tree-row" :class="{ active: activeProjectId === null }">
                    <button class="project-folder" type="button" @click="toggleProjectFolder(null)"><span>{{ isProjectExpanded(null) ? '⌄' : '›' }}</span><span>▱</span></button>
                    <button class="project-name" type="button" @click="selectProject(null)">任务</button>
                    <button class="project-add" type="button" title="新建个人任务" @click="newChatInProject(null)">＋</button>
                  </div>
                  <div v-if="isProjectExpanded(null)" class="project-conversations">
                    <div v-for="entry in chatHistoryForProject(null)" :key="entry.id" class="conversation-row" :class="{ active: entry.id === chatSessionId }"><button type="button" @click="openChatHistory(entry)"><span></span><span><strong>{{ entry.title }}</strong><small>{{ formatChatTime(entry.updatedAt) }}</small></span></button><a-dropdown trigger="click"><button class="conversation-more" type="button" aria-label="任务操作" @click.stop>···</button><template #content><a-doption @click="renameChat(entry)">重命名</a-doption><a-doption @click="setChatArchived(entry, true)">归档</a-doption></template></a-dropdown></div>
                    <p v-if="!chatHistoryForProject(null).length">暂无任务</p>
                  </div>
                </div>
                <div class="archived-conversations"><button class="archived-toggle" type="button" @click="archivedChatsOpen = !archivedChatsOpen"><span>{{ archivedChatsOpen ? '⌄' : '›' }}</span><span>已归档任务</span><b>{{ archivedChatHistory().length }}</b></button><div v-if="archivedChatsOpen" class="project-conversations"><div v-for="entry in archivedChatHistory()" :key="entry.id" class="conversation-row archived"><button type="button" @click="openChatHistory(entry)"><span></span><span><strong>{{ entry.title }}</strong><small>{{ formatChatTime(entry.updatedAt) }}</small></span></button><a-dropdown trigger="click"><button class="conversation-more" type="button" aria-label="归档任务操作" @click.stop>···</button><template #content><a-doption @click="setChatArchived(entry, false)">恢复</a-doption><a-doption @click="renameChat(entry)">重命名</a-doption></template></a-dropdown></div><p v-if="!archivedChatHistory().length">暂无已归档任务</p></div></div>
              </div>
              <section class="artifact-list-panel">
                <div class="artifact-list-head"><strong>项目产物</strong><span>{{ activeProjectArtifacts.length }}</span></div>
                <div v-if="activeProject" class="artifact-list-body">
                  <button v-for="artifact in activeProjectArtifacts" :key="artifact.id" type="button" :class="{ active: artifact.id === selectedArtifactId && artifactWorkspaceOpen }" @click="openArtifact(artifact)">
                    <span class="artifact-type-icon">{{ artifactTypeIcon(artifact.type) }}</span>
                    <span><strong>{{ artifact.title }}</strong><small>{{ new Date(artifact.updatedAt).toLocaleDateString('zh-CN') }}</small></span>
                    <b>›</b>
                  </button>
                  <div v-if="!activeProjectArtifacts.length" class="artifact-list-empty">助手回复保存后，会显示在这里</div>
                </div>
                <div v-else class="artifact-list-empty">未归属项目的任务不沉淀正式产物</div>
              </section>
            </div>
            <a-button v-if="!chatSidebarOpen" class="sidebar-reopen" shape="circle" title="展开侧栏" @click="chatSidebarOpen = true">☰</a-button>
          <div class="chat-content-layout" :class="{ 'workspace-visible': artifactWorkspaceOpen }">
          <div class="codex-chat" :class="{ 'empty-chat': !chatSessionId && !chatMessages.length && !chatReply && !chatThinking && !chatLoading }">
            <button v-if="selectedArtifact && !artifactWorkspaceOpen" class="workspace-reopen" type="button" @click="artifactWorkspaceOpen = true">▤ 工作区</button>
            <div class="codex-thread" :class="{ empty: !chatMessages.length && !chatReply && !chatThinking && !chatLoading }">
              <template v-if="chatMessages.length || chatReply || chatThinking || chatLoading">
                <BubbleList class="element-chat-list" :list="elementChatMessages" item-key="id" :auto-scroll="true" :show-back-button="true" max-height="100%">
                  <template #avatar="{ item }">
                    <div class="message-avatar">{{ item.role === "user" ? "你" : (item.roleName || "Pi").slice(0, 2) }}</div>
                  </template>
                  <template #content="{ item }">
                  <div :class="['message-body', 'element-message-body', item.role]">
                    <strong>{{ item.role === "user" ? "你" : item.roleName }}</strong>
                    <details v-if="item.role === 'assistant' && thinkingText(item.content, item.thinking)" class="execution-panel thinking-panel">
                      <summary><span>{{ item.streaming && chatLoading ? '正在思考' : '思考过程' }}</span><small>{{ thinkingText(item.content, item.thinking).length }} 字</small></summary>
                      <div class="execution-content markdown-body" v-html="thinkingHtml(item.content, item.thinking)"></div>
                    </details>
                    <details v-if="item.role === 'assistant' && messageTrace(item)" class="execution-panel trace-panel">
                      <summary><span>执行记录</span><small>{{ messageTrace(item).skills?.length || 0 }} Skills · {{ messageTrace(item).tools?.length || 0 }} Tools</small></summary>
                      <div class="trace-section"><strong>输入</strong><pre>{{ messageTrace(item).input || '本轮用户消息' }}</pre></div>
                      <div class="trace-section"><strong>Skills</strong><div class="trace-chips"><span v-for="skill in messageTrace(item).skills || []" :key="skill">{{ skill }}</span><em v-if="!messageTrace(item).skills?.length">未启用</em></div></div>
                      <div class="trace-section"><strong>Tools</strong><div v-if="messageTrace(item).tools?.length"><pre v-for="(tool, toolIndex) in messageTrace(item).tools" :key="toolIndex">{{ JSON.stringify(tool, null, 2) }}</pre></div><em v-else>本轮 Runtime 未调用工具</em></div>
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
                    <span v-if="item.streaming && chatLoading" class="chat-cursor">▍</span>
                    <div v-if="item.streaming && chatTrace" class="chat-trace compact">
                      <span>{{ chatTrace.model }}</span>
                      <span>{{ routeLabel(chatTrace.route) }}</span>
                      <span>Skills {{ chatTrace.skills?.length || 0 }}</span>
                      <span>Plugins {{ chatTrace.plugins?.length || 0 }}</span>
                    </div>
                    <button v-if="item.role === 'assistant' && !item.streaming && activeProject" class="save-artifact-button" type="button" @click="saveMessageAsArtifact(item)">＋ 保存为项目产物</button>
                  </div>
                  </template>
                </BubbleList>
              </template>
            </div>

            <form class="codex-composer" @submit.prevent="startChat">
              <RichChatComposer
                ref="chatComposer"
                v-model="chatForm.message"
                :loading="chatLoading"
                :roles="chatRoles"
                :subscriptions="subscriptions"
                :skills="skills"
                :plugins="plugins"
                :starters="chatStarters"
                :supports-images="chatModelCapabilities.images"
                :supports-files="chatModelCapabilities.files"
                :attachments="chatAttachments"
                @update:attachments="chatAttachments = $event"
                @attachment-error="error = $event"
                @select-role="chatForm.roleId = $event"
                @submit="startChat"
              />
              <div class="composer-actions">
                <div class="composer-control composer-model-control">
                  <a-select v-model="chatModelSelection" title="选择本轮使用的模型" :trigger-props="{ autoFitPopupMinWidth: true }">
                    <a-option v-for="choice in chatModelChoices" :key="choice.value" :value="choice.value" :label="choice.label">
                      <span class="model-option-row"><span>{{ choice.label }}</span><small class="model-option-provider">{{ choice.provider }}</small></span>
                    </a-option>
                    <a-option v-if="!chatModelChoices.length" :value="chatModelSelection">{{ modelSettings.model }}</a-option>
                  </a-select>
                </div>
              </div>
            </form>
          </div>
          <aside v-if="artifactWorkspaceOpen" class="artifact-workspace">
            <div class="workspace-head">
              <div><small>{{ activeProject?.name }} / 项目产物</small><strong>{{ selectedArtifact?.title || '产物工作区' }}</strong></div>
              <button type="button" title="关闭工作区" @click="closeArtifactWorkspace">×</button>
            </div>
            <template v-if="selectedArtifact">
              <div class="workspace-toolbar">
                <span>{{ selectedArtifact.type === 'markdown' ? 'Markdown' : selectedArtifact.type }}</span>
                <button v-if="!artifactEditing" type="button" @click="artifactEditing = true">编辑</button>
                <button v-else type="button" class="primary" @click="saveArtifactDraft">保存</button>
                <button type="button" @click="downloadArtifact(selectedArtifact)">下载</button>
              </div>
              <textarea v-if="artifactEditing" v-model="artifactDraft" class="artifact-editor" spellcheck="false"></textarea>
              <div v-else class="artifact-preview markdown-body" v-html="renderMarkdown(selectedArtifact.content)"></div>
              <div class="artifact-source">
                <span>正式归属：{{ activeProject?.name }}</span>
                <span>来源任务：{{ selectedArtifact.conversationId || '当前未保存任务' }}</span>
              </div>
            </template>
            <div v-else class="workspace-empty">从左侧项目产物中选择一个文件</div>
          </aside>
          </div>
          <a-drawer v-model:visible="taskDrawerOpen" title="新建定时任务" :width="760" :footer="false">
            <form class="role-form task-form" @submit.prevent="saveTask">
              <div class="task-drawer-project"><small>所属项目</small><strong>{{ activeProject?.name }}</strong></div>
              <label>任务名称<input v-model.trim="taskForm.name" placeholder="例如：盘后复盘" /></label>
              <label>执行角色<select v-model="taskForm.roleId"><option value="">自动选择</option><option v-for="role in chatRoles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label>
              <label>执行模型<select v-model="taskForm.modelConfigId"><option value="">请选择模型</option><option v-for="model in modelConfigs" :key="model.id" :value="model.id">{{ model.name || model.model }}</option></select></label>
              <label>执行周期<select v-model="taskForm.schedule"><option value="daily">每日执行</option><option value="weekly">每周执行</option></select></label>
              <label class="task-prompt-field">任务指令
                <RichChatComposer ref="taskComposer" v-model="taskForm.prompt" class="task-prompt-composer" placeholder="输入 @ 指定角色、# 选择股票、/ 调用技能与插件" :roles="chatRoles" :subscriptions="subscriptions" :skills="skills" :plugins="plugins" :starters="chatStarters" :show-attachments="false" :show-submit="false" @select-role="taskForm.roleId = $event" />
              </label>
              <div class="button-row"><a-button @click="taskDrawerOpen = false">取消</a-button><a-button type="primary" html-type="submit">创建定时任务</a-button></div>
            </form>
          </a-drawer>
          </div>
        </section>

        <section v-if="activeModule === 'pi-tasks'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>定时任务</h2>
              <p>集中管理各项目中按计划自动执行的任务。</p>
            </div>
            <div class="button-row">
              <a-select v-model="taskProjectFilterId" allow-clear placeholder="全部项目" style="width: 200px">
                <a-option v-for="project in activeProjects" :key="project.id" :value="project.id">{{ project.name }}</a-option>
              </a-select>
              <a-button type="primary" :disabled="!taskProjectFilterId" @click="openTaskCreator(projects.find(item => item.id === taskProjectFilterId))">＋ 新建定时任务</a-button>
            </div>
          </div>
          <a-drawer v-model:visible="taskDrawerOpen" title="新建定时任务" :width="520" :footer="false"><form class="role-form task-form" @submit.prevent="saveTask">
            <label>任务名称<input v-model.trim="taskForm.name" /></label>
            <label>执行角色
              <select v-model="taskForm.roleId">
                <option value="">选择角色</option>
                <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
              </select>
            </label>
            <label>调度方式
              <select v-model="taskForm.schedule">
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
          </form></a-drawer>
          <div class="card-grid" v-if="projectTasks.length">
            <article v-for="task in projectTasks" :key="task.id" class="feature-card">
              <div class="task-card-project">{{ projects.find(item => Number(item.id) === Number(task.projectId))?.name || '未知项目' }}</div>
              <h3>{{ task.name }}</h3><p>{{ task.modelName }} · {{ taskScheduleLabel(task.schedule) }}</p><p>{{ task.prompt }}</p>
              <button type="button" class="small danger" @click="deleteTask(task.id)">删除</button>
            </article>
          </div>
          <div v-else class="empty-state">{{ taskProjectFilterId ? '当前项目暂无定时任务。' : '暂无定时任务。' }}</div>
        </section>

        <section v-if="activeModule === 'pi-roles'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>角色管理</h2>
              <p>角色决定 Pi Runtime 的身份、职责边界，并可勾选允许使用的 Skill 与插件。</p>
            </div>
            <a-button type="primary" @click="openRoleCreator">新建角色</a-button>
          </div>
          <a-drawer v-model:visible="roleDrawerOpen" :title="roleForm.id ? '修改角色' : '新建角色'" :width="560" :footer="false" @cancel="resetRoleForm"><form class="role-form" @submit.prevent="saveRole">
            <div class="role-avatar-editor">
              <a-avatar :size="72"><img v-if="roleForm.avatar" :src="roleForm.avatar" alt="角色头像" /><template v-else>{{ roleInitials(roleForm) }}</template></a-avatar>
              <div><label class="role-avatar-upload">上传头像<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onRoleAvatarChange" /></label><a-button v-if="roleForm.avatar" type="text" status="danger" @click="roleForm.avatar = ''">移除头像</a-button><p>支持 JPG、PNG、WebP、GIF，最大 1 MB</p></div>
            </div>
            <label>角色名称<input v-model.trim="roleForm.name" required placeholder="如：行情观察员 / 策略研究员 / 风控审查员" /></label>
            <label>角色职责<textarea v-model.trim="roleForm.responsibility" placeholder="这个角色负责什么事情？"></textarea></label>
            <label>系统提示词<textarea v-model.trim="roleForm.systemPrompt" placeholder="给这个角色的行为边界和输出要求"></textarea></label>
            <label>默认模型<select v-model="roleForm.modelConfigId"><option value="">跟随系统默认模型</option><option v-for="config in modelConfigs" :key="'new-role-model-' + config.id" :value="config.id">{{ config.name }} · {{ config.model }}</option></select></label>
            <div class="button-row"><a-button @click="roleDrawerOpen = false; resetRoleForm()">取消</a-button><a-button type="primary" html-type="submit" :loading="roleSaving">{{ roleForm.id ? '保存修改' : '创建角色' }}</a-button></div>
          </form></a-drawer>
          <div v-if="!roles.length" class="empty-state">还没有配置角色。</div>
          <a-table v-else class="role-table" :columns="roleColumns" :data="roles" row-key="id" :pagination="false" :scroll="{ x: 1080 }">
            <template #role="{ record: role }"><div class="role-identity"><a-avatar :size="40"><img v-if="role.avatar" :src="role.avatar" :alt="role.name" /><template v-else>{{ roleInitials(role) }}</template></a-avatar><div><strong>{{ role.name }}</strong><small>ID {{ role.id }}</small></div></div></template>
            <template #model="{ record: role }">{{ modelConfigs.find(item => item.id === role.modelConfigId)?.name || '系统默认模型' }}</template>
            <template #capabilities="{ record: role }"><a-space><a-tag>Skill {{ (role.skillIds || []).length }}</a-tag><a-tag>插件 {{ (role.pluginIds || []).length }}</a-tag></a-space></template>
            <template #createdAt="{ record: role }">{{ new Date(role.createdAt).toLocaleString('zh-CN') }}</template>
            <template #actions="{ record: role }"><a-space><a-button type="text" size="small" @click="openRoleEditor(role)">修改</a-button><a-button type="text" size="small" @click="selectedRole = role; roleCapabilityDrawerOpen = true">配置能力</a-button><a-popconfirm content="确定删除该角色吗？" @ok="removeRole(role.id)"><a-button type="text" size="small" status="danger">删除</a-button></a-popconfirm></a-space></template>
          </a-table>
          <a-drawer v-model:visible="roleCapabilityDrawerOpen" title="角色能力配置" :width="560" :footer="false"><template v-if="selectedRole"><h3>{{ selectedRole.name }}</h3><div class="capability-panel"><h3>Skill</h3><label v-for="skill in ownedSkills" :key="'role-skill-' + skill.id" class="check-item"><input type="checkbox" :checked="(selectedRole.skillIds || []).includes(skill.id)" @change="toggleRoleId(selectedRole.skillIds, skill.id)" />{{ skill.name }}</label></div><div class="capability-panel"><h3>插件</h3><label v-for="plugin in plugins" :key="'role-plugin-' + plugin.id" class="check-item"><input type="checkbox" :checked="(selectedRole.pluginIds || []).includes(plugin.id)" @change="toggleRoleId(selectedRole.pluginIds, plugin.id)" />{{ plugin.name }}</label></div><a-button type="primary" long @click="saveRoleCapabilities(selectedRole)">保存能力配置</a-button></template></a-drawer>
        </section>

        <section v-if="activeModule === 'pi-skills'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>Skill 管理</h2>
              <p>浏览社区公开与系统 Skill，也可以上传、复制并二次改造自己的能力包，最后授权给角色使用。</p>
            </div><a-button type="primary" @click="resetSkillForm(); skillDrawerOpen = true">上传 Skill</a-button>
          </div>
          <div class="skill-tabs">
            <button type="button" :class="{ active: skillView === 'market' }" @click="skillView = 'market'">Skill 市场 <span>{{ marketSkills.length }}</span></button>
            <button type="button" :class="{ active: skillView === 'mine' }" @click="skillView = 'mine'">我的 Skill <span>{{ ownedSkills.length }}</span></button>
            <button type="button" :class="{ active: skillView === 'system' }" @click="skillView = 'system'">系统 Skill <span>{{ systemSkills.length }}</span></button>
          </div>
          <a-drawer v-model:visible="skillDrawerOpen" :title="skillForm.id ? '编辑 Skill' : '上传 Skill'" :width="620" :footer="false"><form class="role-form" @submit.prevent="addSkill">
            <label>Skill 名称<input v-model.trim="skillForm.name" placeholder="如：A 股行情分析" /></label>
            <label>说明<input v-model.trim="skillForm.description" placeholder="这个 Skill 提供什么能力" /></label>
            <label>可见范围<select v-model="skillForm.visibility"><option value="private">仅自己可见</option><option value="public">公开到 Skill 市场</option></select></label>
            <div class="import-row">
              <label class="file-button">导入 ZIP<input type="file" accept=".zip" @change="importSkillZip" /></label>
              <label class="file-button">导入文件夹<input type="file" webkitdirectory multiple @change="importSkillFolder" /></label>
              <span v-if="skillUploadSummary" class="hint dark">{{ skillUploadSummary }}</span>
            </div>
            <label>Skill 内容<textarea v-model.trim="skillForm.content" placeholder="粘贴 Skill Markdown / 提示词 / 工具说明"></textarea></label>
            <div class="button-row"><button>{{ skillForm.id ? "保存修改" : "上传 Skill" }}</button><button v-if="skillForm.id" type="button" class="ghost" @click="resetSkillForm">取消编辑</button></div>
          </form></a-drawer>
          <a-drawer v-model:visible="skillPreviewOpen" :width="820" :footer="false" unmount-on-close>
            <template #title><span>Skill 预览</span></template>
            <div v-if="selectedSkillPreview" class="skill-preview">
              <div class="skill-preview-head">
                <div><h2>{{ selectedSkillPreview.name }}</h2><p>{{ selectedSkillPreview.description }}</p></div>
                <a-space>
                  <a-button v-if="selectedSkillPreview.owned" @click="skillPreviewOpen = false; editSkill(selectedSkillPreview)">编辑</a-button>
                  <a-button v-else @click="copySkill(selectedSkillPreview)">复制使用</a-button>
                </a-space>
              </div>
              <dl class="skill-preview-meta">
                <dt>类型</dt><dd>{{ selectedSkillPreview.isSystem ? '系统内置' : (selectedSkillPreview.visibility === 'public' ? '公开 Skill' : '私有 Skill') }}</dd>
                <dt>来源</dt><dd>{{ sourceTypeLabel(selectedSkillPreview.sourceType) }}<span v-if="selectedSkillPreview.ownerName"> · {{ selectedSkillPreview.ownerName }}</span></dd>
                <dt v-if="selectedSkillPreview.packageName">能力包</dt><dd v-if="selectedSkillPreview.packageName">{{ selectedSkillPreview.packageName }}</dd>
              </dl>
              <a-spin :loading="skillPreviewLoading" class="skill-browser-loading">
                <div class="skill-browser">
                  <aside class="skill-file-tree">
                    <div class="skill-file-tree-title"><strong>文件系统</strong><span>{{ skillPreviewFiles.length }} 个文件</span></div>
                    <button v-for="row in skillFileRows(skillPreviewFiles)" :key="(row.directory ? 'dir-' : 'file-') + row.path" type="button" :class="{ directory: row.directory, active: !row.directory && row.path === skillPreviewFilePath }" :style="{ paddingLeft: (12 + row.depth * 16) + 'px' }" :disabled="row.directory" @click="!row.directory && (skillPreviewFilePath = row.path)">
                      <span>{{ row.directory ? '▾' : '◇' }}</span><em>{{ row.name }}</em><small v-if="!row.directory">{{ row.size }} B</small>
                    </button>
                  </aside>
                  <section class="skill-file-preview">
                    <div class="skill-file-head">
                      <div><strong>{{ skillPreviewFilePath || '未选择文件' }}</strong><span v-if="selectedSkillFile">{{ skillFileLanguage(selectedSkillFile.path) }} · {{ selectedSkillFile.size }} B</span></div>
                      <a-radio-group v-if="selectedSkillFile?.encoding === 'utf8'" v-model="skillPreviewMode" type="button" size="small"><a-radio value="rendered">渲染预览</a-radio><a-radio value="source">原始内容</a-radio></a-radio-group>
                    </div>
                    <div v-if="selectedSkillReferences.length" class="skill-references"><strong>引用文件</strong><button v-for="reference in selectedSkillReferences" :key="reference" type="button" @click="skillPreviewFilePath = reference">↗ {{ reference }}</button></div>
                    <div v-if="!selectedSkillFile" class="empty-state">请选择一个文件。</div>
                    <div v-else-if="selectedSkillFile.encoding !== 'utf8'" class="empty-state">二进制文件仅展示目录信息，暂不支持内容预览。</div>
                    <div v-else-if="skillPreviewMode === 'rendered' && /\.md$/i.test(selectedSkillFile.path)" class="skill-preview-content markdown-body" v-html="renderMarkdown(selectedSkillFileContent)" @click="handleSkillPreviewLink"></div>
                    <pre v-else class="skill-preview-source">{{ selectedSkillFileContent }}</pre>
                  </section>
                </div>
              </a-spin>
            </div>
          </a-drawer>
          <div v-if="!displayedSkills.length" class="empty-state">这里还没有 Skill。</div>
          <div class="role-grid">
            <article v-for="skill in displayedSkills" :key="skill.id" class="role-card">
              <div class="card-title">
                <div><strong>{{ skill.name }}</strong><span>{{ skill.isSystem ? "系统内置" : (skill.visibility === "public" ? "公开" : "私有") }}<template v-if="!skill.isSystem && !skill.owned"> · {{ skill.ownerName || "社区用户" }}</template></span></div>
                <div class="card-actions">
                  <button class="small" @click="previewSkill(skill)">预览</button>
                  <button v-if="skill.owned" class="small" @click="editSkill(skill)">编辑</button>
                  <button v-else class="small" @click="copySkill(skill)">复制使用</button>
                  <button v-if="skill.owned" class="small danger" @click="removeSkill(skill.id)">删除</button>
                </div>
              </div>
              <p>{{ skill.description }}</p>
              <p class="hint dark">来源：{{ sourceTypeLabel(skill.sourceType) }}<span v-if="skill.packageName"> · {{ skill.packageName }}</span></p>
              <p v-if="skill.packageFiles?.length" class="hint dark">包文件：{{ skill.packageFiles.length }} 个</p>
              <pre class="skill-card-content">{{ skill.content }}</pre>
            </article>
          </div>
          <a-drawer v-model:visible="roleCapabilityDrawerOpen" title="角色能力配置" :width="560" :footer="false">
            <template v-if="selectedRole"><h3>{{ selectedRole.name }}</h3><p class="hint dark">将 Skill 与插件授权给当前角色。</p>
              <div class="capability-panel"><h3>Skill</h3><label v-for="skill in ownedSkills" :key="'drawer-skill-' + skill.id" class="check-item"><input type="checkbox" :checked="(selectedRole.skillIds || []).includes(skill.id)" @change="toggleRoleId(selectedRole.skillIds, skill.id)" /><span>{{ skill.name }}</span></label><div v-if="!ownedSkills.length" class="hint dark">暂无自己的 Skill。</div></div>
              <div class="capability-panel"><h3>插件</h3><label v-for="plugin in plugins" :key="'drawer-plugin-' + plugin.id" class="check-item"><input type="checkbox" :checked="(selectedRole.pluginIds || []).includes(plugin.id)" @change="toggleRoleId(selectedRole.pluginIds, plugin.id)" /><span>{{ plugin.name }}</span></label><div v-if="!plugins.length" class="hint dark">暂无插件。</div></div>
              <a-button type="primary" long @click="saveRoleCapabilities(selectedRole)">保存能力配置</a-button>
            </template>
          </a-drawer>
        </section>

        <section v-if="activeModule === 'pi-plugins'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>插件管理</h2>
              <p>插件是可编辑、可发布、可下线的运行时模块。角色可以选择允许使用哪些插件。</p>
            </div>
            <a-space><a-button @click="importPluginFromTemplate">在线导入模板</a-button><a-button type="primary" @click="resetPluginForm(); pluginDrawerOpen = true">新建插件</a-button></a-space>
          </div>
          <a-drawer v-model:visible="pluginDrawerOpen" :title="pluginForm.id ? '编辑插件' : '新建插件'" :width="680" :footer="false"><form class="role-form" @submit.prevent="savePlugin">
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
            </form></a-drawer>
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
        </section>

        <section v-if="activeModule === 'data-sources'" class="module-panel data-source-management">
          <div class="panel-head"><div><h2>数据源管理</h2><p>统一注册、认证、适配和编排行情数据服务。</p></div><a-space><a-button @click="dataSourceRoutingOpen = true">市场路由配置</a-button><a-button type="primary" @click="openHttpDataSource()">新建 HTTP 数据源</a-button></a-space></div>
          <div class="data-source-stats"><a-card><a-statistic title="全部数据源" :value="allDataSources.length" /></a-card><a-card><a-statistic title="自定义 HTTP" :value="httpDataSources.length" /></a-card><a-card><a-statistic title="已启用" :value="allDataSources.filter(item => item.enabled).length" /></a-card><a-card><a-statistic title="支持市场" :value="3" /></a-card></div>
          <a-card class="data-source-table-card">
            <a-table :data="allDataSources" row-key="key" :pagination="false" :bordered="false">
              <template #columns>
                <a-table-column title="数据源" :width="220"><template #cell="{ record }"><div class="source-name"><span class="source-logo">{{ record.name.slice(0, 1) }}</span><div><strong>{{ record.name }}</strong><small>{{ record.key }}</small></div></div></template></a-table-column>
                <a-table-column title="协议" :width="130" data-index="protocol" />
                <a-table-column title="认证" :width="130"><template #cell="{ record }"><a-tag>{{ {none:'无需认证',token:'Token',api_key:'API Key',bearer:'Bearer',hmac:'HMAC 签名'}[record.authType] || record.authType }}</a-tag></template></a-table-column>
                <a-table-column title="市场" :width="230"><template #cell="{ record }"><a-space wrap><a-tag v-for="market in record.markets" :key="market">{{ marketLabel(market) }}</a-tag></a-space></template></a-table-column>
                <a-table-column title="数据能力"><template #cell="{ record }"><a-space wrap><a-tag v-for="capability in record.capabilities" :key="capability" color="arcoblue">{{ {bars:'K 线',quote:'实时报价',symbols:'标的搜索',fundamentals:'基本面'}[capability] || capability }}</a-tag></a-space></template></a-table-column>
                <a-table-column title="状态" :width="100"><template #cell="{ record }"><a-badge :status="record.enabled ? 'success' : 'default'" :text="record.enabled ? '已启用' : '已停用'" /></template></a-table-column>
                <a-table-column title="操作" :width="180" fixed="right"><template #cell="{ record }"><a-space v-if="!record.builtin"><a-button type="text" size="small" @click="openHttpDataSource(record)">编辑</a-button><a-popconfirm content="确定删除该数据源吗？" @ok="removeHttpDataSource(record)"><a-button type="text" status="danger" size="small">删除</a-button></a-popconfirm></a-space><a-tag v-else>系统内置</a-tag></template></a-table-column>
              </template>
            </a-table>
          </a-card>

          <a-drawer v-model:visible="dataSourceDrawerOpen" :title="httpDataSourceForm.id ? '编辑 HTTP 数据源' : '新建 HTTP 数据源'" :width="760" :footer="false" unmount-on-close>
            <a-form :model="httpDataSourceForm" layout="vertical">
              <div class="form-row"><a-form-item label="数据源名称"><a-input v-model="httpDataSourceForm.name" placeholder="如：供应商实时行情" /></a-form-item><a-form-item label="唯一标识"><a-input v-model="httpDataSourceForm.key" placeholder="vendor-realtime" /></a-form-item></div>
              <a-form-item label="HTTP 地址" extra="支持 {market}、{symbol}、{start}、{end}、{interval} 占位符"><a-input v-model="httpDataSourceForm.baseUrl" /></a-form-item>
              <div class="form-row"><a-form-item label="请求方法"><a-radio-group v-model="httpDataSourceForm.method" type="button"><a-radio value="GET">GET</a-radio><a-radio value="POST">POST</a-radio></a-radio-group></a-form-item><a-form-item label="认证方式"><a-select v-model="httpDataSourceForm.authType"><a-option value="none">无需认证</a-option><a-option value="api_key">API Key</a-option><a-option value="bearer">Bearer Token</a-option><a-option value="hmac">HMAC 签名</a-option></a-select></a-form-item></div>
              <a-card v-if="httpDataSourceForm.authType !== 'none'" class="auth-config-card" title="认证配置"><a-form-item label="密钥环境变量"><a-input v-model="httpDataSourceForm.authConfig.secretRef" placeholder="VENDOR_API_SECRET" /></a-form-item><a-form-item v-if="httpDataSourceForm.authType === 'api_key'" label="Header 名称"><a-input v-model="httpDataSourceForm.authConfig.headerName" /></a-form-item><template v-if="httpDataSourceForm.authType === 'hmac'"><div class="form-row"><a-form-item label="签名 Header"><a-input v-model="httpDataSourceForm.authConfig.signatureHeader" /></a-form-item><a-form-item label="时间戳 Header"><a-input v-model="httpDataSourceForm.authConfig.timestampHeader" /></a-form-item></div></template></a-card>
              <div class="form-row"><a-form-item label="支持市场"><a-checkbox-group v-model="httpDataSourceForm.markets"><a-checkbox value="A Share">A 股</a-checkbox><a-checkbox value="Hong Kong">港股</a-checkbox><a-checkbox value="US">美股</a-checkbox></a-checkbox-group></a-form-item><a-form-item label="数据能力"><a-checkbox-group v-model="httpDataSourceForm.capabilities"><a-checkbox value="bars">K 线</a-checkbox><a-checkbox value="symbols">标的搜索</a-checkbox><a-checkbox value="fundamentals">基本面</a-checkbox></a-checkbox-group></a-form-item></div>
              <a-form-item label="固定 Headers（JSON）"><a-textarea v-model="httpDataSourceForm.headersText" :auto-size="{ minRows: 3, maxRows: 6 }" class="code-editor" /></a-form-item>
              <a-form-item label="响应适配脚本" extra="脚本只能接收 payload 与 input，并需返回系统 bars、symbols 或 metrics 规范"><a-textarea v-model="httpDataSourceForm.adapterScript" :auto-size="{ minRows: 12, maxRows: 22 }" class="code-editor" /></a-form-item>
              <a-alert v-if="dataSourceTestMessage" :type="dataSourceTestMessage.includes('成功') ? 'success' : 'warning'">{{ dataSourceTestMessage }}</a-alert>
              <div class="drawer-footer"><a-button :loading="dataSourceTesting" @click="testHttpDataSource">测试连接</a-button><a-button type="primary" @click="saveHttpDataSource">保存数据源</a-button></div>
            </a-form>
          </a-drawer>

          <a-drawer v-model:visible="dataSourceRoutingOpen" title="市场数据源路由" :width="620" :footer="false">
            <a-alert type="info">系统按照从左到右的顺序调用，失败后自动降级到下一数据源。</a-alert>
            <a-form layout="vertical" class="routing-form">
              <a-form-item v-for="market in ['A Share','Hong Kong','US']" :key="market" :label="marketLabel(market) + '主备顺序'"><a-select v-model="dataSourceSettings.providerChains[market]" multiple><a-option v-for="source in allDataSources.filter(item => item.markets.includes(market))" :key="source.key" :value="source.key">{{ source.name }}</a-option></a-select></a-form-item>
              <template v-if="usesFutuSource()"><div class="form-row"><a-form-item label="Futu Host"><a-input v-model="dataSourceSettings.futuHost" /></a-form-item><a-form-item label="Futu Port"><a-input-number v-model="dataSourceSettings.futuPort" :min="1" :max="65535" /></a-form-item></div></template>
              <a-card v-if="usesTushareSource()" class="auth-config-card" title="Tushare Pro 认证">
                <a-form-item label="Token" :extra="dataSourceSettings.hasTushareToken ? 'Token 已安全保存；留空表示继续使用原 Token。' : 'Token 将加密保存在 AlphaDock 服务器中，保存后不再回显。'"><a-input-password v-model="dataSourceSettings.tushareToken" placeholder="请输入 tushare.pro 用户 Token" allow-clear /></a-form-item>
                <a-alert v-if="dataSourceTestMessage" :type="dataSourceTestMessage.includes('成功') ? 'success' : 'warning'">{{ dataSourceTestMessage }}</a-alert>
                <a-button :loading="dataSourceTesting" @click="testTushareConnection">测试 Tushare 连接</a-button>
              </a-card>
              <a-button type="primary" long :loading="settingsSaving" @click="saveDataSourceSettings">保存路由配置</a-button>
            </a-form>
          </a-drawer>
        </section>

        <section v-if="activeModule === 'display-settings'" class="module-panel display-settings-page">
          <div class="panel-head"><div><h2>显示偏好</h2><p>个人设置 / 显示偏好 · 按照你的看盘习惯，为不同市场分别设置涨跌颜色。</p></div><a-button type="primary" :loading="settingsSaving" @click="saveDisplaySettings">保存设置</a-button></div>
          <div class="display-setting-section">
            <div class="setting-section-head"><h3>市场涨跌颜色</h3><p>各市场可以使用不同规则，设置会同步应用到行情列表与 K 线图。</p></div>
            <div class="market-color-grid">
              <div v-for="market in ['A Share', 'Hong Kong', 'US']" :key="market" class="market-color-tile">
                <div class="market-color-title"><strong>{{ marketLabel(market) }}</strong><small>行情与 K 线颜色</small></div>
                <a-radio-group v-model="displaySettings.marketColors[market]" type="button" class="market-color-options">
                  <a-radio value="red-up"><span class="color-preview"><i class="rise-red"></i>红涨 <i class="fall-green"></i>绿跌</span></a-radio>
                  <a-radio value="green-up"><span class="color-preview"><i class="rise-green"></i>绿涨 <i class="fall-red"></i>红跌</span></a-radio>
                </a-radio-group>
              </div>
            </div>
          </div>
          <a-alert v-if="settingsMessage" type="success">{{ settingsMessage }}</a-alert>
        </section>

        <section v-if="activeModule === 'model-monitoring'" class="module-panel model-monitoring-page" v-loading="monitoringLoading">
          <div class="panel-head">
            <div><h2>模型监控</h2><p>{{ monitoringScope === 'all' ? '全站模型资源消耗、用户活跃度与项目对话分布。' : '你的模型调用消耗、对话活跃度与项目使用分布。' }}</p></div>
            <a-space>
              <a-radio-group v-if="currentUser?.role === 'admin'" v-model="monitoringScope" type="button" @change="loadModelMonitoring"><a-radio value="mine">个人视图</a-radio><a-radio value="all">管理员视图</a-radio></a-radio-group>
              <a-radio-group v-model="monitoringRange" type="button" @change="loadModelMonitoring"><a-radio value="day">今日</a-radio><a-radio value="week">近 7 日</a-radio><a-radio value="month">近 30 日</a-radio></a-radio-group>
            </a-space>
          </div>
          <div class="monitoring-kpis">
            <a-card><small>Token 总消耗</small><strong>{{ formatTokenCount(modelMonitoring.summary.totalTokens) }}</strong><span>输入 {{ formatTokenCount(modelMonitoring.summary.promptTokens) }} · 输出 {{ formatTokenCount(modelMonitoring.summary.completionTokens) }}</span></a-card>
            <a-card><small>模型调用</small><strong>{{ modelMonitoring.summary.calls || 0 }}</strong><span>成功率 {{ modelMonitoring.summary.successRate ?? 100 }}%</span></a-card>
            <a-card><small>对话数量</small><strong>{{ modelMonitoring.summary.conversations || 0 }}</strong><span>{{ modelMonitoring.summary.turns || 0 }} 个用户消息轮次</span></a-card>
            <a-card><small>平均响应</small><strong>{{ modelMonitoring.summary.averageLatencyMs ? (modelMonitoring.summary.averageLatencyMs / 1000).toFixed(1) + 's' : '—' }}</strong><span>每次底层模型请求</span></a-card>
          </div>
          <div class="monitoring-grid">
            <a-card class="monitoring-trend-card">
              <template #title><div class="monitoring-card-title"><strong>Token 消耗趋势</strong><span>输入 / 输出每日分布</span></div></template>
              <div v-if="modelMonitoring.trend.some(item => item.totalTokens)" class="token-trend">
                <div v-for="item in modelMonitoring.trend" :key="item.date" class="trend-column" :title="item.date + ' · ' + item.totalTokens + ' Token'">
                  <div class="trend-bars"><i class="completion" :style="{ height: monitoringBarWidth(item.completionTokens, modelMonitoring.trend, 'totalTokens') }"></i><i class="prompt" :style="{ height: monitoringBarWidth(item.promptTokens, modelMonitoring.trend, 'totalTokens') }"></i></div>
                  <small>{{ item.date.slice(5) }}</small>
                </div>
              </div>
              <a-empty v-else description="当前周期还没有 Token 调用记录" />
              <div class="chart-legend"><span><i class="prompt"></i>输入 Token</span><span><i class="completion"></i>输出 Token</span></div>
            </a-card>
            <a-card>
              <template #title><div class="monitoring-card-title"><strong>模型消耗分布</strong><span>按 Token 排名</span></div></template>
              <div v-if="modelMonitoring.models.length" class="rank-list"><div v-for="(item, index) in modelMonitoring.models" :key="item.name" class="rank-row"><b>{{ index + 1 }}</b><div><span><strong>{{ item.name }}</strong><small>{{ item.calls }} 次调用 · {{ formatTokenCount(item.tokens) }} Token</small></span><i><em :style="{ width: monitoringBarWidth(item.tokens, modelMonitoring.models, 'tokens') }"></em></i></div></div></div>
              <a-empty v-else description="暂无模型调用记录" />
            </a-card>
            <a-card>
              <template #title><div class="monitoring-card-title"><strong>项目对话排行</strong><span>对话次数与 Token 消耗</span></div></template>
              <div v-if="modelMonitoring.projects.length" class="rank-list"><div v-for="(item, index) in modelMonitoring.projects" :key="item.name" class="rank-row project-rank"><b>{{ index + 1 }}</b><div><span><strong>{{ item.name }}</strong><small>{{ item.conversations }} 个对话 · {{ formatTokenCount(item.tokens) }} Token</small></span><i><em :style="{ width: monitoringBarWidth(item.conversations, modelMonitoring.projects, 'conversations') }"></em></i></div></div></div>
              <a-empty v-else description="当前周期暂无项目对话" />
            </a-card>
            <a-card v-if="monitoringScope === 'all'">
              <template #title><div class="monitoring-card-title"><strong>用户消耗排行</strong><span>管理员可见</span></div></template>
              <div v-if="modelMonitoring.users.length" class="rank-list"><div v-for="(item, index) in modelMonitoring.users" :key="item.name" class="rank-row user-rank"><b>{{ index + 1 }}</b><div><span><strong>{{ item.name }}</strong><small>{{ item.calls }} 次调用 · {{ formatTokenCount(item.tokens) }} Token</small></span><i><em :style="{ width: monitoringBarWidth(item.tokens, modelMonitoring.users, 'tokens') }"></em></i></div></div></div>
              <a-empty v-else description="暂无用户调用记录" />
            </a-card>
          </div>
        </section>

        <section v-if="activeModule === 'models'" class="module-panel model-management">
          <div class="panel-head"><div><h2>模型管理</h2><p>选择平台私有模型，或接入 GLM、MiniMax、OpenAI 等在线模型 API。</p></div><a-button type="primary" @click="newModelConfig">接入在线模型</a-button></div>
          <div class="data-source-stats model-stats"><a-card><a-statistic title="全部模型" :value="systemPrivateModels.length + modelConfigs.filter(item => item.provider !== 'ollama').length" /></a-card><a-card><a-statistic title="平台私有" :value="systemPrivateModels.length" /></a-card><a-card><a-statistic title="已启用私有模型" :value="systemPrivateModels.filter(item => item.enabled).length" /></a-card><a-card><a-statistic title="在线 API" :value="modelConfigs.filter(item => item.provider !== 'ollama').length" /></a-card></div>
          <a-alert type="info" class="pi-config-alert">平台私有模型由 AlphaDock 服务器统一托管，用户只需选择；在线模型的地址、API Key 与生成参数由 Pi Runtime 解析使用。</a-alert>
          <a-card v-if="systemPrivateModels.length" class="data-source-table-card model-table-card" title="系统私有模型">
            <a-table :data="systemPrivateModels" row-key="model" :pagination="false" :bordered="false">
              <template #columns>
                <a-table-column title="模型"><template #cell="{ record }"><div class="source-name"><span class="source-logo model-logo">私</span><div><strong>{{ record.model }}</strong><small>Ollama 本地部署</small></div></div></template></a-table-column>
                <a-table-column title="模型服务地址（IP / Port）" :width="420"><template #cell="{ record }"><a-input v-model="record.baseUrl" :disabled="currentUser?.role !== 'admin'" placeholder="http://192.168.1.10:11434"><template #append><a-button v-if="currentUser?.role === 'admin'" type="text" @click="savePrivateModelEndpoint(record)">保存</a-button></template></a-input></template></a-table-column>
                <a-table-column title="磁盘占用" :width="140"><template #cell="{ record }">{{ formatModelSize(record.size) }}</template></a-table-column>
                <a-table-column title="状态" :width="130"><template #cell="{ record }"><a-badge :status="record.enabled ? 'success' : 'normal'" :text="record.enabled ? '已启用' : '已禁用'" /></template></a-table-column>
                <a-table-column title="系统控制" :width="180" fixed="right"><template #cell="{ record }"><a-switch v-if="currentUser?.role === 'admin'" :model-value="record.enabled" checked-text="启用" unchecked-text="禁用" @change="setSystemPrivateModelEnabled(record, $event)" /><span v-else class="muted-cell">仅管理员可操作</span></template></a-table-column>
              </template>
            </a-table>
          </a-card>
          <a-card class="data-source-table-card model-table-card">
            <a-table :data="modelConfigs" row-key="id" :pagination="false" :bordered="false">
              <template #columns>
                <a-table-column title="模型配置" :width="250"><template #cell="{ record }"><div class="source-name"><span class="source-logo model-logo">{{ record.provider === 'ollama' ? '私' : '云' }}</span><div><strong>{{ record.name }}</strong><small>{{ record.model }}</small></div></div></template></a-table-column>
                <a-table-column title="部署方式" :width="130"><template #cell="{ record }"><a-tag :color="record.provider === 'ollama' ? 'green' : 'arcoblue'">{{ modelDeploymentLabel(record) }}</a-tag></template></a-table-column>
                <a-table-column title="提供方" :width="190"><template #cell="{ record }">{{ modelProviderLabel(record.provider) }}</template></a-table-column>
                <a-table-column title="服务地址"><template #cell="{ record }"><span class="model-endpoint">{{ record.baseUrl }}</span></template></a-table-column>
                <a-table-column title="密钥" :width="170"><template #cell="{ record }"><span v-if="record.provider === 'ollama'" class="muted-cell">无需密钥</span><span v-else>{{ record.hasApiKey ? '已安全配置' : '未配置' }}</span></template></a-table-column>
                <a-table-column title="状态" :width="110"><template #cell="{ record }"><a-badge :status="record.isDefault ? 'success' : 'normal'" :text="record.isDefault ? '默认' : '可用'" /></template></a-table-column>
                <a-table-column title="操作" :width="170" fixed="right"><template #cell="{ record }"><a-tag v-if="record.provider === 'ollama'">平台托管 · 可直接选择</a-tag><a-space v-else><a-button type="text" size="small" @click="editModelConfig(record)">配置</a-button><a-popconfirm content="删除后，引用该配置的角色将恢复使用默认模型。确定删除吗？" @ok="deleteModelConfig(record)"><a-button type="text" status="danger" size="small">删除</a-button></a-popconfirm></a-space></template></a-table-column>
              </template>
              <template #empty><a-empty description="还没有模型配置，请先接入本地或在线模型。" /></template>
            </a-table>
          </a-card>

          <a-drawer v-model:visible="modelDrawerOpen" :title="modelSettings.id ? '编辑模型配置' : '接入模型'" :width="720" :footer="false" unmount-on-close>
            <a-form :model="modelSettings" layout="vertical" @submit="saveModelSettings">
              <a-alert type="info" class="model-protocol-alert">在线模型通过 OpenAI Chat Completions 兼容协议交给 Pi Runtime 调用。平台私有模型由服务器统一配置，不在这里暴露部署信息。</a-alert>
              <div class="form-row"><a-form-item label="配置名称" required><a-input v-model="modelSettings.name" placeholder="如：研究专用 GLM" /></a-form-item><a-form-item label="模型提供方" required><a-select v-model="modelSettings.provider" @change="applyModelProviderDefaults"><a-option value="openai">OpenAI / 兼容 API</a-option><a-option value="glm">智谱 GLM</a-option><a-option value="minimax">MiniMax</a-option></a-select></a-form-item></div>
              <div class="form-row"><a-form-item label="模型 ID" required extra="填写服务端实际接受的模型标识"><a-input v-model="modelSettings.model" placeholder="如：gpt-5-mini、glm-4.5" /></a-form-item><a-form-item label="接口协议"><a-input model-value="OpenAI Chat Completions" disabled /></a-form-item></div>
              <a-form-item label="服务地址（Base URL）" required><a-input v-model="modelSettings.baseUrl" :placeholder="modelSettings.provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'" /></a-form-item>
              <a-card v-if="modelSettings.provider !== 'ollama'" class="auth-config-card" title="访问认证"><a-form-item label="API Key" :extra="modelSettings.hasApiKey ? '密钥已安全保存；留空表示继续使用原密钥。' : '密钥将加密保存在 AlphaDock 服务器中，保存后不再回显。'"><a-input-password v-model="modelSettings.apiKey" placeholder="请输入模型服务商提供的 API Key" allow-clear /></a-form-item></a-card>
              <a-divider orientation="left">生成参数</a-divider>
              <div class="form-row"><a-form-item label="Temperature"><a-input-number v-model="modelSettings.temperature" :min="0" :max="2" :step="0.1" /></a-form-item><a-form-item label="推理强度"><a-select v-model="modelSettings.reasoningEffort"><a-option value="low">低</a-option><a-option value="medium">中</a-option><a-option value="high">高</a-option></a-select></a-form-item></div>
              <div class="form-row"><a-form-item label="最大输出 Token"><a-input-number v-model="modelSettings.maxOutputTokens" :min="256" :max="131072" /></a-form-item><a-form-item label="上下文预算 Token"><a-input-number v-model="modelSettings.contextBudgetTokens" :min="1024" :max="1048576" /></a-form-item></div>
              <a-form-item><a-checkbox v-model="modelSettings.isDefault">设为默认模型（新任务与未绑定角色优先使用）</a-checkbox></a-form-item>
              <a-alert v-if="modelTestMessage" :type="modelTestMessage.includes('可用') || modelTestMessage.includes('已连接') ? 'success' : 'warning'">{{ modelTestMessage }}</a-alert>
              <div class="drawer-footer"><a-button :loading="modelTesting" @click="testModelConnection">测试连接</a-button><a-button type="primary" html-type="submit" :loading="settingsSaving">保存模型配置</a-button></div>
            </a-form>
          </a-drawer>
        </section>
      </main>
    </AppShell>
  `,
});

app.use(ArcoVue);
app.use(ElementPlus);
app.use(router);
app.mount("#app");
