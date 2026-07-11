import { createApp, nextTick } from "vue";
import "./style.css";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";

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

createApp({
  data() {
    return {
      token: localStorage.getItem("stock-harness-token") ?? "",
      authMode: "login",
      auth: { username: "admin", password: "" },
      currentUser: null,
      loading: false,
      authLoading: false,
      error: "",
      strategies: [],
      result: null,
      form: {
        market: "A Share",
        symbol: "600519",
        start: "2020-01-01",
        end: new Date().toISOString().slice(0, 10),
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
  async mounted() {
    if (this.token) {
      try {
        await this.loadMe();
        await this.loadStrategies();
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
        localStorage.setItem("stock-harness-token", this.token);
        await this.loadStrategies();
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
      this.result = null;
      localStorage.removeItem("stock-harness-token");
    },
    async loadStrategies() {
      this.strategies = await this.api("/strategies");
      this.applyStrategyDefaults();
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
        this.renderCharts();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    renderCharts() {
      if (!this.result) return;

      const bars = this.result.bars;
      Plotly.react(
        "priceChart",
        [
          {
            type: "candlestick",
            x: bars.map((row) => row.date),
            open: bars.map((row) => row.open),
            high: bars.map((row) => row.high),
            low: bars.map((row) => row.low),
            close: bars.map((row) => row.close),
            name: "价格",
          },
        ],
        { title: "价格走势", height: 420, margin: { l: 50, r: 20, t: 45, b: 40 } },
        { responsive: true }
      );

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
        { responsive: true }
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
        { responsive: true }
      );
    },
  },
  template: `
    <div v-if="!token" class="auth-screen">
      <form class="auth-card" @submit.prevent="submitAuth">
        <h1>stock-harness</h1>
        <p>登录后访问本地量化助手。</p>
        <label>
          用户名
          <input v-model.trim="auth.username" autocomplete="username" />
        </label>
        <label>
          密码
          <input v-model="auth.password" type="password" autocomplete="current-password" />
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

        <section>
          <h2>市场与标的</h2>
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
        </section>

        <section>
          <h2>数据源</h2>
          <label>行情来源
            <select v-model="form.data_source">
              <option value="auto">自动数据源</option>
              <option value="futu">Futu OpenD</option>
            </select>
          </label>
          <template v-if="form.data_source === 'futu'">
            <label>Futu Host<input v-model.trim="form.futu_host" /></label>
            <label>Futu Port<input type="number" v-model.number="form.futu_port" /></label>
            <p class="hint">请先启动富途 OpenD，并确认行情权限可用。</p>
          </template>
        </section>

        <section>
          <h2>回测设置</h2>
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
        </section>

        <button @click="runBacktest" :disabled="loading">{{ loading ? "回测中..." : "运行回测" }}</button>
      </aside>

      <main>
        <header>
          <h1>本地量化助手</h1>
          <p>Vue Vite Web -> Node API -> Python Backtrader Core</p>
        </header>
        <div v-if="error" class="error">{{ error }}</div>
        <section class="metrics" v-if="result">
          <article><span>策略总收益</span><strong>{{ pct(result.stats.total_return) }}</strong></article>
          <article><span>买入持有</span><strong>{{ pct(result.stats.benchmark_return) }}</strong></article>
          <article><span>年化收益</span><strong>{{ pct(result.stats.annualized_return) }}</strong></article>
          <article><span>最大回撤</span><strong>{{ pct(result.stats.max_drawdown) }}</strong></article>
          <article><span>夏普比率</span><strong>{{ Number(result.stats.sharpe).toFixed(2) }}</strong></article>
          <article><span>交易次数</span><strong>{{ result.stats.trade_count }}</strong></article>
        </section>
        <section class="charts" v-if="result">
          <div id="priceChart"></div>
          <div id="equityChart"></div>
          <div id="drawdownChart"></div>
        </section>
      </main>
    </div>
  `,
}).mount("#app");
