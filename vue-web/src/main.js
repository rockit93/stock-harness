import { createApp, nextTick } from "vue";
import "./style.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";

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

function isoDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
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

createApp({
  data() {
    return {
      token: localStorage.getItem("stock-harness-token") ?? sessionStorage.getItem("stock-harness-token") ?? "",
      authMode: "login",
      auth: { username: "admin", password: "", rememberMe: true },
      currentUser: null,
      activeModule: "dashboard",
      loading: false,
      authLoading: false,
      dashboardLoading: false,
      lookupLoading: false,
      settingsSaving: false,
      error: "",
      settingsMessage: "",
      strategies: [],
      result: null,
      dataSourceSettings: {
        dataSource: "auto",
        futuHost: "127.0.0.1",
        futuPort: 11111,
        updatedAt: null,
      },
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
      },
      pluginForm: {
        id: null,
        name: "",
        description: "",
        sourceUrl: "",
        code: defaultPluginCode,
      },
      taskForm: {
        name: "盘后复盘",
        roleId: "",
        schedule: "manual",
        prompt: "总结订阅股票今天的走势、异常波动和明天观察点。",
      },
      chatForm: {
        roleId: "",
        message: "帮我分析 600519 最近的走势，并给出可回测的策略假设。",
      },
      subscriptions: [],
      subscriptionForm: {
        market: "A Share",
        symbol: "600519",
        stockName: "",
        remark: "",
      },
      symbolSuggestions: [],
      selectedRange: "month",
      chartData: {},
      chartErrors: {},
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
  async mounted() {
    if (this.token) {
      try {
        await this.bootstrap();
      } catch {
        this.logout();
      }
    }
  },
  methods: {
    async bootstrap() {
      await this.loadMe();
      await Promise.all([
        this.loadDataSourceSettings(),
        this.loadStrategies(),
        this.loadSubscriptions(),
        this.loadRoles(),
        this.loadSkills(),
        this.loadPlugins(),
      ]);
    },
    async api(path, options = {}) {
      const headers = {
        "content-type": "application/json",
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
    setModule(moduleName) {
      this.activeModule = moduleName;
      this.error = "";
      this.settingsMessage = "";
    },
    async loadDataSourceSettings() {
      this.dataSourceSettings = await this.api("/settings/data-source");
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
      await this.api(`/subscriptions/${id}`, { method: "DELETE" });
      await this.loadSubscriptions();
    },
    async refreshDashboardCharts() {
      this.chartErrors = {};
      if (!this.subscriptions.length) {
        this.chartData = {};
        return;
      }
      this.dashboardLoading = true;
      const nextData = {};
      const nextErrors = {};
      await Promise.all(
        this.subscriptions.map(async (item) => {
          try {
            const payload = await this.api("/bars", {
              method: "POST",
              body: JSON.stringify({
                market: item.market,
                symbol: item.symbol,
                start: startForRange(this.selectedRange),
                end: isoDate(),
                adjust: "qfq",
              }),
            });
            nextData[item.id] = payload.bars;
          } catch (error) {
            nextErrors[item.id] = error instanceof Error ? error.message : String(error);
          }
        }),
      );
      this.chartData = nextData;
      this.chartErrors = nextErrors;
      this.dashboardLoading = false;
      await nextTick();
      this.renderDashboardCharts();
    },
    renderDashboardCharts() {
      for (const item of this.subscriptions) {
        const bars = this.chartData[item.id] ?? [];
        const chartId = `subChart-${item.id}`;
        const node = document.getElementById(chartId);
        if (!node || !bars.length) continue;
        Plotly.react(
          chartId,
          [
            {
              type: "candlestick",
              x: bars.map((row) => row.date),
              open: bars.map((row) => row.open),
              high: bars.map((row) => row.high),
              low: bars.map((row) => row.low),
              close: bars.map((row) => row.close),
              name: item.symbol,
            },
          ],
          { title: `${item.symbol} ${this.rangeLabel(this.selectedRange)}走势`, height: 260, margin: { l: 42, r: 14, t: 42, b: 32 } },
          { responsive: true },
        );
      }
    },
    async loadRoles() {
      this.roles = await this.api("/agent-roles");
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
    async addSkill() {
      this.error = "";
      try {
        await this.api("/pi/skills", { method: "POST", body: JSON.stringify(this.skillForm) });
        this.skillForm = { name: "", description: "", content: "" };
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
      this.pluginForm = { id: plugin.id, name: plugin.name, description: plugin.description, sourceUrl: plugin.sourceUrl ?? "", code: plugin.code };
    },
    resetPluginForm() {
      this.pluginForm = { id: null, name: "", description: "", sourceUrl: "", code: defaultPluginCode };
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
      };
    },
    applyDefaultSymbol() {
      this.form.symbol = { "A Share": "600519", "Hong Kong": "00700", US: "AAPL" }[this.form.market];
    },
    applyStrategyDefaults() {
      const selected = this.strategies.find((item) => item.key === this.form.strategy);
      if (selected) this.form.strategy_params = { ...selected.default_params };
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
    dataSourceLabel(value) {
      return value === "futu" ? "Futu OpenD" : "自动数据源（AkShare/Yahoo）";
    },
    rangeLabel(range) {
      return { day: "当日", week: "本周", month: "本月" }[range] ?? range;
    },
    pluginStatusLabel(status) {
      return { draft: "草稿", published: "已发布", offline: "已下线" }[status] ?? status;
    },
    formatTime(value) {
      if (!value) return "";
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    },
    pct(value) {
      return `${(Number(value ?? 0) * 100).toFixed(2)}%`;
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
      Plotly.react(
        "equityChart",
        [
          { type: "scatter", x: this.result.equity.map((row) => row.date), y: this.result.equity.map((row) => row.value), name: "策略" },
          {
            type: "scatter",
            x: this.result.benchmark_equity.map((row) => row.date),
            y: this.result.benchmark_equity.map((row) => row.value),
            name: "买入持有",
          },
        ],
        { title: "权益曲线", height: 320, margin: { l: 50, r: 20, t: 45, b: 40 } },
        { responsive: true },
      );
      Plotly.react(
        "drawdownChart",
        [{ type: "scatter", fill: "tozeroy", x: this.result.drawdown.map((row) => row.date), y: this.result.drawdown.map((row) => row.value * 100), name: "回撤" }],
        { title: "回撤 (%)", height: 320, margin: { l: 50, r: 20, t: 45, b: 40 } },
        { responsive: true },
      );
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

      <main>
        <header>
          <h1>本地量化助手</h1>
          <p>Pi Runtime -> Node API -> Python Backtrader Core</p>
        </header>
        <div v-if="error" class="error">{{ error }}</div>

        <section v-if="activeModule === 'dashboard'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>Dashboard</h2>
              <p>订阅股票，按市场查看当日、本周、本月走势。</p>
              <p class="hint dark">当前数据源：{{ dataSourceLabel(dataSourceSettings.dataSource) }}</p>
            </div>
            <div class="range-tabs">
              <button v-for="range in ['day', 'week', 'month']" :key="range" :class="{ active: selectedRange === range }" @click="selectedRange = range; refreshDashboardCharts()">{{ rangeLabel(range) }}</button>
            </div>
          </div>

          <form class="subscription-form" @submit.prevent="addSubscription">
            <select v-model="subscriptionForm.market" @change="symbolSuggestions = []">
              <option value="A Share">A 股</option>
              <option value="Hong Kong">港股</option>
              <option value="US">美股</option>
            </select>
            <div class="lookup-field">
              <input v-model.trim="subscriptionForm.symbol" placeholder="股票代码，如 600519 / 00700 / AAPL" @blur="lookupSymbol" />
              <div v-if="symbolSuggestions.length" class="suggestions">
                <button v-for="item in symbolSuggestions" :key="item.market + item.symbol" type="button" @mousedown.prevent="selectSymbol(item)">
                  <strong>{{ item.symbol }}</strong>
                  <span>{{ item.name }}</span>
                  <small>{{ marketLabel(item.market) }} · {{ item.source }}</small>
                </button>
              </div>
            </div>
            <input v-model.trim="subscriptionForm.stockName" placeholder="股票名称" />
            <input v-model.trim="subscriptionForm.remark" placeholder="备注，可选" />
            <button :disabled="lookupLoading">{{ lookupLoading ? "查询中..." : "订阅" }}</button>
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
                  <button class="small danger" @click="removeSubscription(item.id)">删除</button>
                </div>
                <div class="subscription-meta">
                  <span>订阅人：{{ item.subscribedBy || currentUser?.username }}</span>
                  <span>订阅时间：{{ formatTime(item.createdAt) }}</span>
                  <span v-if="item.remark">备注：{{ item.remark }}</span>
                </div>
                <div v-if="chartErrors[item.id]" class="chart-error">K 线加载失败：{{ chartErrors[item.id] }}</div>
                <div v-else :id="'subChart-' + item.id" class="mini-chart"></div>
              </article>
            </div>
          </section>
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
              <label>复权方式
                <select v-model="form.adjust">
                  <option value="qfq">qfq 前复权</option>
                  <option value="hfq">hfq 后复权</option>
                  <option value="none">none 不复权</option>
                </select>
              </label>
              <label>策略
                <select v-model="form.strategy" @change="applyStrategyDefaults">
                  <option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategyLabel(strategy.key, strategy.label) }}</option>
                </select>
              </label>
              <label v-for="(_, key) in form.strategy_params" :key="key">{{ paramLabel(key) }}<input type="number" v-model.number="form.strategy_params[key]" /></label>
              <label>初始资金<input type="number" v-model.number="form.cash" /></label>
              <label>单边手续费 (bps)<input type="number" v-model.number="form.commission_bps" /></label>
              <button :disabled="loading">{{ loading ? "回测中..." : "运行回测" }}</button>
            </form>
            <div class="backtest-result">
              <section class="metrics" v-if="result">
                <article><span>策略总收益</span><strong>{{ pct(result.stats.total_return) }}</strong></article>
                <article><span>买入持有</span><strong>{{ pct(result.stats.benchmark_return) }}</strong></article>
                <article><span>年化收益</span><strong>{{ pct(result.stats.annualized_return) }}</strong></article>
                <article><span>最大回撤</span><strong>{{ pct(result.stats.max_drawdown) }}</strong></article>
                <article><span>夏普比率</span><strong>{{ Number(result.stats.sharpe).toFixed(2) }}</strong></article>
                <article><span>交易次数</span><strong>{{ result.stats.trade_count }}</strong></article>
              </section>
              <section class="charts" v-if="result">
                <div id="equityChart"></div>
                <div id="drawdownChart"></div>
              </section>
              <div v-else class="empty-state">设置参数后运行回测。</div>
            </div>
          </div>
        </section>

        <section v-if="activeModule === 'pi-chat'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>新对话</h2>
              <p>选择角色后发起大模型对话。运行时会自动带上角色提示词、已勾选 Skill、已勾选插件和平台数据源上下文。</p>
            </div>
          </div>
          <div class="pi-layout">
            <form class="settings-form">
              <label>角色
                <select v-model="chatForm.roleId">
                  <option value="">选择角色</option>
                  <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
                </select>
              </label>
              <label>消息<textarea v-model.trim="chatForm.message"></textarea></label>
              <button type="button" disabled>启动对话</button>
              <p class="hint dark">入口已预留；下一步接 Pi Runtime 会话线程和模型流式响应。</p>
            </form>
            <div class="empty-state">这里将展示模型回复、工具调用轨迹、Skill 注入内容和插件执行结果。</div>
          </div>
        </section>

        <section v-if="activeModule === 'pi-tasks'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>任务管理</h2>
              <p>把常用工作流固定成任务：选择角色、调度方式、任务提示词，后续由 Pi Runtime 执行。</p>
            </div>
          </div>
          <form class="role-form task-form">
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
            <label>任务提示词<textarea v-model.trim="taskForm.prompt"></textarea></label>
            <button type="button" disabled>保存任务</button>
          </form>
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

        <section v-if="activeModule === 'settings'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>系统管理</h2>
              <p>配置平台默认数据源。保存后，Dashboard、股票查询、回测和后续 Pi Runtime 任务都会使用这套配置。</p>
            </div>
          </div>
          <form class="settings-form system-form" @submit.prevent="saveDataSourceSettings">
            <label>默认数据源
              <select v-model="dataSourceSettings.dataSource">
                <option value="auto">自动数据源（AkShare/Yahoo）</option>
                <option value="futu">Futu OpenD</option>
              </select>
            </label>
            <div v-if="dataSourceSettings.dataSource === 'futu'" class="source-panel">
              <h3>Futu OpenD 服务器</h3>
              <div class="source-grid">
                <label>Host<input v-model.trim="dataSourceSettings.futuHost" placeholder="127.0.0.1" /></label>
                <label>Port<input type="number" v-model.number="dataSourceSettings.futuPort" min="1" max="65535" /></label>
              </div>
            </div>
            <button :disabled="settingsSaving">{{ settingsSaving ? "保存中..." : "保存并切换数据源" }}</button>
            <div v-if="settingsMessage" class="success">{{ settingsMessage }}</div>
            <p class="hint dark">自动数据源适合不开 Futu OpenD 时使用；Futu OpenD 适合实时行情、订阅推送和交易接口。</p>
          </form>
        </section>
      </main>
    </div>
  `,
}).mount("#app");
