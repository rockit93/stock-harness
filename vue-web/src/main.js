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
      error: "",
      strategies: [],
      result: null,
      roles: [],
      roleForm: {
        name: "策略研究员",
        responsibility: "把用户的策略想法拆成可回测的规则和参数。",
        systemPrompt: "你是策略研究员，只输出可验证、可回测、可解释的策略方案。",
      },
      subscriptions: [],
      subscriptionForm: {
        market: "A Share",
        symbol: "600519",
        name: "",
      },
      selectedRange: "month",
      chartData: {},
      form: {
        market: "A Share",
        symbol: "600519",
        start: "2020-01-01",
        end: isoDate(),
        adjust: "qfq",
        data_source: "auto",
        futu_host: "127.0.0.1",
        futu_port: 11111,
        strategy: "ma_cross",
        strategy_params: { fast: 10, slow: 30 },
        cash: 100000,
        commission_bps: 3,
      },
    };
  },
  computed: {
    groupedSubscriptions() {
      const groups = {
        "A Share": [],
        "Hong Kong": [],
        US: [],
      };
      for (const item of this.subscriptions) {
        groups[item.market]?.push(item);
      }
      return groups;
    },
  },
  async mounted() {
    if (this.token) {
      try {
        await this.loadMe();
        await Promise.all([this.loadStrategies(), this.loadSubscriptions(), this.loadRoles()]);
      } catch {
        this.logout();
      }
    }
  },
  methods: {
    async api(path, options = {}) {
      const headers = {
        "content-type": "application/json",
        ...(options.headers ?? {}),
      };
      if (this.token) {
        headers["x-jwt-token"] = this.token;
      }

      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? payload.message ?? "请求失败");
      }
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
        await Promise.all([this.loadStrategies(), this.loadSubscriptions(), this.loadRoles()]);
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
      this.result = null;
      localStorage.removeItem("stock-harness-token");
      sessionStorage.removeItem("stock-harness-token");
    },
    async loadStrategies() {
      this.strategies = await this.api("/strategies");
      this.applyStrategyDefaults();
    },
    async loadSubscriptions() {
      this.subscriptions = await this.api("/subscriptions");
      await this.refreshDashboardCharts();
    },
    async loadRoles() {
      this.roles = await this.api("/agent-roles");
    },
    async addRole() {
      this.error = "";
      try {
        await this.api("/agent-roles", {
          method: "POST",
          body: JSON.stringify(this.roleForm),
        });
        this.roleForm = {
          name: "",
          responsibility: "",
          systemPrompt: "",
        };
        await this.loadRoles();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async removeRole(id) {
      await this.api(`/agent-roles/${id}`, { method: "DELETE" });
      await this.loadRoles();
    },
    async addSubscription() {
      this.error = "";
      try {
        await this.api("/subscriptions", {
          method: "POST",
          body: JSON.stringify(this.subscriptionForm),
        });
        this.subscriptionForm.name = "";
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
      if (!this.subscriptions.length) return;
      this.dashboardLoading = true;
      const nextData = {};
      try {
        await Promise.all(
          this.subscriptions.map(async (item) => {
            const payload = await this.api("/bars", {
              method: "POST",
              body: JSON.stringify({
                market: item.market,
                symbol: item.symbol,
                start: startForRange(this.selectedRange),
                end: isoDate(),
                adjust: "qfq",
                data_source: "auto",
              }),
            });
            nextData[item.id] = payload.bars;
          }),
        );
        this.chartData = nextData;
        await nextTick();
        this.renderDashboardCharts();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.dashboardLoading = false;
      }
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
          {
            title: `${item.symbol} ${this.rangeLabel(this.selectedRange)}走势`,
            height: 260,
            margin: { l: 42, r: 14, t: 42, b: 32 },
          },
          { responsive: true },
        );
      }
    },
    applyDefaultSymbol() {
      const defaults = {
        "A Share": "600519",
        "Hong Kong": "00700",
        US: "AAPL",
      };
      this.form.symbol = defaults[this.form.market];
    },
    applyStrategyDefaults() {
      const selected = this.strategies.find((item) => item.key === this.form.strategy);
      if (selected) {
        this.form.strategy_params = { ...selected.default_params };
      }
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
    rangeLabel(range) {
      return { day: "当日", week: "本周", month: "本月" }[range] ?? range;
    },
    pct(value) {
      return `${(Number(value ?? 0) * 100).toFixed(2)}%`;
    },
    num(value) {
      return Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 });
    },
    async runBacktest() {
      this.loading = true;
      this.error = "";
      try {
        this.result = await this.api("/backtest", {
          method: "POST",
          body: JSON.stringify(this.form),
        });
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
          {
            type: "scatter",
            x: this.result.equity.map((row) => row.date),
            y: this.result.equity.map((row) => row.value),
            name: "策略",
          },
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
        [
          {
            type: "scatter",
            fill: "tozeroy",
            x: this.result.drawdown.map((row) => row.date),
            y: this.result.drawdown.map((row) => row.value * 100),
            name: "回撤",
          },
        ],
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
          <button :class="{ active: activeModule === 'dashboard' }" @click="activeModule = 'dashboard'">Dashboard</button>
          <button :class="{ active: activeModule === 'backtest' }" @click="activeModule = 'backtest'">回测策略</button>
          <button :class="{ active: activeModule === 'pi' }" @click="activeModule = 'pi'">Pi Agent</button>
        </nav>
      </aside>

      <main>
        <header>
          <h1>本地量化助手</h1>
          <p>Pi Agent -> Node API -> Python Backtrader Core</p>
        </header>
        <div v-if="error" class="error">{{ error }}</div>

        <section v-if="activeModule === 'dashboard'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>Dashboard</h2>
              <p>订阅股票，按市场查看当日、本周、本月走势。</p>
            </div>
            <div class="range-tabs">
              <button v-for="range in ['day', 'week', 'month']" :key="range" :class="{ active: selectedRange === range }" @click="selectedRange = range; refreshDashboardCharts()">
                {{ rangeLabel(range) }}
              </button>
            </div>
          </div>

          <form class="subscription-form" @submit.prevent="addSubscription">
            <select v-model="subscriptionForm.market">
              <option value="A Share">A 股</option>
              <option value="Hong Kong">港股</option>
              <option value="US">美股</option>
            </select>
            <input v-model.trim="subscriptionForm.symbol" placeholder="股票代码，如 600519 / 00700 / AAPL" />
            <input v-model.trim="subscriptionForm.name" placeholder="备注名称，可选" />
            <button>订阅</button>
          </form>

          <div v-if="dashboardLoading" class="hint dark">正在加载 K 线...</div>
          <div v-if="!subscriptions.length" class="empty-state">还没有订阅股票。</div>

          <section v-for="(items, market) in groupedSubscriptions" :key="market" v-show="items.length" class="market-section">
            <h3>{{ marketLabel(market) }}</h3>
            <div class="subscription-grid">
              <article v-for="item in items" :key="item.id" class="subscription-card">
                <div class="card-title">
                  <strong>{{ item.symbol }}</strong>
                  <span>{{ item.name || marketLabel(item.market) }}</span>
                  <button class="small danger" @click="removeSubscription(item.id)">删除</button>
                </div>
                <div :id="'subChart-' + item.id" class="mini-chart"></div>
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
                  <option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">
                    {{ strategyLabel(strategy.key, strategy.label) }}
                  </option>
                </select>
              </label>
              <label v-for="(_, key) in form.strategy_params" :key="key">
                {{ paramLabel(key) }}
                <input type="number" v-model.number="form.strategy_params[key]" />
              </label>
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

        <section v-if="activeModule === 'pi'" class="module-panel">
          <div class="panel-head">
            <div>
              <h2>Pi Agent 角色管理</h2>
              <p>把对话里的任务分派给不同角色，各司其职。后续定时任务也会绑定到这些角色。</p>
            </div>
          </div>

          <form class="role-form" @submit.prevent="addRole">
            <label>角色名称<input v-model.trim="roleForm.name" placeholder="如：行情观察员 / 策略研究员 / 风控审查员" /></label>
            <label>角色职责<textarea v-model.trim="roleForm.responsibility" placeholder="这个角色负责什么事情"></textarea></label>
            <label>系统提示词<textarea v-model.trim="roleForm.systemPrompt" placeholder="给这个 subagent 的行为边界和输出要求"></textarea></label>
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
              <pre>{{ role.systemPrompt }}</pre>
            </article>
          </div>
        </section>
      </main>
    </div>
  `,
}).mount("#app");
