<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import BacktestResults from "./BacktestResults.vue";

const props = defineProps({
  strategies: { type: Array, default: () => [] },
  subscriptions: { type: Array, default: () => [] },
  request: { type: Function, required: true },
  pct: { type: Function, required: true },
});
const emit = defineEmits(["refresh-strategies"]);

const tab = ref("strategies");
const saving = ref(false);
const debugging = ref(false);
const editorVisible = ref(false);
const paperDrawerVisible = ref(false);
const selectedResult = ref(null);
const batchResults = ref([]);
const selectedSymbols = ref([]);
const remoteSymbolOptions = ref([]);
const symbolSearching = ref(false);
let symbolSearchTimer = null;
let symbolSearchSequence = 0;
const editor = reactive({ id: null, name: "新回测策略", description: "", definitionText: "" });
const debugForm = reactive({
  market: "A Share", symbolsText: "", start: "2023-01-01", end: new Date().toISOString().slice(0, 10),
  strategy: "ma_cross", cash: 100000, commission_bps: 3,
});
const paperRuns = ref(JSON.parse(localStorage.getItem("stock-harness-paper-runs") || "[]"));
const paperForm = reactive({ name: "模拟运行", market: "A Share", strategy: "ma_cross", intervalMinutes: 5, defaultCapital: 100000, accounts: [] });
const timers = new Map();

const customStrategies = computed(() => props.strategies.filter((item) => item.source === "custom"));
const subscribedSymbols = computed(() => props.subscriptions
  .filter((item) => item.market === debugForm.market)
  .map((item) => String(item.symbol || "").trim())
  .filter(Boolean));
const dateRange = computed({
  get: () => [debugForm.start, debugForm.end],
  set: (value) => { [debugForm.start, debugForm.end] = Array.isArray(value) ? value : ["", ""]; },
});
const effectiveSymbols = computed(() => [...new Set([
  ...selectedSymbols.value.map(String), ...symbols(debugForm.symbolsText),
].map((item) => item.trim()).filter(Boolean))]);
function subscriptionOptions() {
  return props.subscriptions
    .filter((item) => item.market === debugForm.market && item.symbol)
    .map((item) => ({ symbol: String(item.symbol), name: item.stockName || item.name || "", market: item.market }));
}
function mergeSymbolOptions(items) {
  const merged = new Map([...subscriptionOptions(), ...remoteSymbolOptions.value, ...items].map((item) => [String(item.symbol), item]));
  remoteSymbolOptions.value = [...merged.values()];
}
function useSubscribedSymbols() {
  selectedSymbols.value = [...new Set(subscribedSymbols.value)];
  debugForm.symbolsText = "";
  remoteSymbolOptions.value = subscriptionOptions();
}
watch([() => debugForm.market, () => props.subscriptions], useSubscribedSymbols, { immediate: true, deep: true });
const defaultDefinition = () => ({
  indicators: { fast: { type: "sma", period: 10 }, slow: { type: "sma", period: 30 } },
  entry: { all: [{ left: "fast", op: "crosses_above", right: "slow" }] },
  exit: { all: [{ left: "fast", op: "crosses_below", right: "slow" }] },
  risk: { stop_loss_pct: 0.08, take_profit_pct: 0.2 },
});

function symbols(text) { return [...new Set(text.split(/[\s,，;；]+/).map((v) => v.trim()).filter(Boolean))]; }
function searchSymbols(keyword) {
  window.clearTimeout(symbolSearchTimer);
  const clean = String(keyword || "").trim();
  if (!clean) { remoteSymbolOptions.value = subscriptionOptions(); return; }
  const sequence = ++symbolSearchSequence;
  symbolSearchTimer = window.setTimeout(async () => {
    symbolSearching.value = true;
    try {
      const payload = await props.request("/symbols/lookup", {
        method: "POST", body: JSON.stringify({ market: debugForm.market, keyword: clean, limit: 20 }),
      });
      if (sequence === symbolSearchSequence) mergeSymbolOptions(payload.symbols || []);
    } finally {
      if (sequence === symbolSearchSequence) symbolSearching.value = false;
    }
  }, 280);
}
function openEditor(strategy) {
  Object.assign(editor, strategy ? {
    id: strategy.id, name: strategy.name, description: strategy.description || "", definitionText: JSON.stringify(strategy.definition, null, 2),
  } : { id: null, name: "新回测策略", description: "", definitionText: JSON.stringify(defaultDefinition(), null, 2) });
  editorVisible.value = true;
}
async function saveStrategy() {
  saving.value = true;
  try {
    const definition = JSON.parse(editor.definitionText);
    await props.request(editor.id ? `/backtest-strategies/${editor.id}` : "/backtest-strategies", {
      method: editor.id ? "PUT" : "POST",
      body: JSON.stringify({ name: editor.name, description: editor.description, definition }),
    });
    editorVisible.value = false;
    emit("refresh-strategies");
  } finally { saving.value = false; }
}
async function removeStrategy(strategy) {
  if (!window.confirm(`确认删除策略“${strategy.name}”？`)) return;
  await props.request(`/backtest-strategies/${strategy.id}`, { method: "DELETE" });
  emit("refresh-strategies");
}
async function runBatch() {
  debugging.value = true;
  batchResults.value = [];
  selectedResult.value = null;
  const list = effectiveSymbols.value;
  const settled = await Promise.allSettled(list.map((symbol) => props.request("/backtest", {
    method: "POST",
    body: JSON.stringify({ ...debugForm, symbol, strategy_params: {}, adjust: "qfq" }),
  })));
  batchResults.value = settled.map((item, index) => item.status === "fulfilled"
    ? { symbol: list[index], ok: true, result: item.value }
    : { symbol: list[index], ok: false, error: item.reason?.message || String(item.reason) });
  selectedResult.value = batchResults.value.find((row) => row.ok)?.result || null;
  debugging.value = false;
}
function persistPaperRuns() { localStorage.setItem("stock-harness-paper-runs", JSON.stringify(paperRuns.value)); }
function availablePaperStocks() { return props.subscriptions.filter((item) => item.market === paperForm.market && item.symbol); }
function resetPaperAccounts() {
  const existing = new Map(paperForm.accounts.map((item) => [item.symbol, item]));
  paperForm.accounts = availablePaperStocks().map((stock) => ({
    symbol: String(stock.symbol), name: stock.stockName || stock.name || "", selected: existing.get(String(stock.symbol))?.selected ?? true,
    initialCapital: existing.get(String(stock.symbol))?.initialCapital ?? paperForm.defaultCapital, lotSize: paperForm.market === "A Share" ? 100 : 1,
  }));
}
function applyDefaultCapital() { paperForm.accounts.forEach((account) => { account.initialCapital = paperForm.defaultCapital; }); }
function openPaperDrawer() {
  Object.assign(paperForm, { name: "模拟运行", market: "A Share", strategy: "ma_cross", intervalMinutes: 5, defaultCapital: 100000, accounts: [] });
  resetPaperAccounts(); paperDrawerVisible.value = true;
}
function addPaperRun() {
  const accounts = paperForm.accounts.filter((item) => item.selected).map((item) => ({ ...item, cash: item.initialCapital, position: 0 }));
  if (!accounts.length) return;
  paperRuns.value.push({ id: Date.now(), name: paperForm.name.trim() || "模拟运行", market: paperForm.market, strategy: paperForm.strategy,
    symbolsText: accounts.map((item) => item.symbol).join(", "), intervalMinutes: paperForm.intervalMinutes, accounts,
    createdAt: new Date().toISOString(), active: false, lastRunAt: null, status: "尚未运行", results: [] });
  persistPaperRuns(); paperDrawerVisible.value = false;
}
async function executePaperRun(run) {
  run.status = "运行中";
  const end = new Date(); const start = new Date(end); start.setFullYear(start.getFullYear() - 1);
  const settled = await Promise.allSettled(symbols(run.symbolsText).map((symbol) => props.request("/backtest", {
    method: "POST", body: JSON.stringify({ market: run.market, symbol, strategy: run.strategy, strategy_params: {}, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), adjust: "qfq", cash: 100000, commission_bps: 3 }),
  })));
  run.results = settled.map((item, index) => {
    const lastOrder = item.status === "fulfilled" ? (item.value.orders || []).at(-1) : null;
    return { symbol: symbols(run.symbolsText)[index], ok: item.status === "fulfilled", stats: item.status === "fulfilled" ? item.value.stats : null, lastOrder };
  });
  run.lastRunAt = new Date().toLocaleString("zh-CN"); run.status = "运行正常"; persistPaperRuns();
}
function togglePaperRun(run) {
  run.active = !run.active;
  if (run.active) {
    executePaperRun(run);
    timers.set(run.id, window.setInterval(() => executePaperRun(run), Math.max(1, run.intervalMinutes) * 60000));
  } else { window.clearInterval(timers.get(run.id)); timers.delete(run.id); }
  persistPaperRuns();
}
function removePaperRun(run) { window.clearInterval(timers.get(run.id)); timers.delete(run.id); paperRuns.value = paperRuns.value.filter((item) => item.id !== run.id); persistPaperRuns(); }
onBeforeUnmount(() => {
  window.clearTimeout(symbolSearchTimer);
  timers.forEach((timer) => window.clearInterval(timer));
});
</script>

<template>
  <section class="strategy-workbench">
    <header class="workbench-head"><div><h2>回测策略管理</h2><p>创建规则、批量验证，并将满意的策略投入模拟盯盘。</p></div><a-button type="primary" @click="openEditor()">新建策略</a-button></header>
    <a-tabs v-model:active-key="tab" type="rounded">
      <a-tab-pane key="strategies" title="策略列表">
        <div class="strategy-stats">
          <a-card><a-statistic title="全部策略" :value="strategies.length" /></a-card>
          <a-card><a-statistic title="系统内置" :value="strategies.filter(item => item.source !== 'custom').length" /></a-card>
          <a-card><a-statistic title="自定义策略" :value="customStrategies.length" /></a-card>
          <a-card><a-statistic title="模拟任务" :value="paperRuns.length" /></a-card>
        </div>
        <a-card class="strategy-table-card" :bordered="true">
          <a-table :data="strategies" row-key="key" :pagination="false" :bordered="false">
            <template #columns>
              <a-table-column title="策略" :width="230"><template #cell="{ record }"><div class="strategy-name"><span class="strategy-mark">策</span><div><strong>{{ record.label || record.name }}</strong><small>{{ record.english_label || record.key }}</small></div></div></template></a-table-column>
              <a-table-column title="类型" :width="110"><template #cell="{ record }"><a-tag :color="record.source === 'custom' ? 'arcoblue' : 'gray'">{{ record.source === 'custom' ? '自定义' : '系统内置' }}</a-tag></template></a-table-column>
              <a-table-column title="策略说明" :width="300"><template #cell="{ record }"><span class="strategy-description">{{ record.description || '可用于历史数据回测与模拟运行。' }}</span></template></a-table-column>
              <a-table-column title="核心规则"><template #cell="{ record }"><span class="rule-text">{{ record.rule_summary || '按策略定义执行入场、离场与风险控制。' }}</span></template></a-table-column>
              <a-table-column title="默认参数" :width="230"><template #cell="{ record }"><div class="parameter-tags compact"><a-tag v-for="(value, key) in record.default_params" :key="key">{{ key }} = {{ value }}</a-tag><span v-if="!record.default_params || !Object.keys(record.default_params).length" class="muted-value">—</span></div></template></a-table-column>
              <a-table-column title="操作" :width="190" fixed="right"><template #cell="{ record }"><a-space><a-button type="text" size="small" @click="debugForm.strategy = record.key; tab = 'debug'">调试运行</a-button><template v-if="record.source === 'custom'"><a-button type="text" size="small" @click="openEditor(record)">编辑</a-button><a-popconfirm content="确定删除该回测策略吗？" @ok="removeStrategy(record)"><a-button type="text" size="small" status="danger">删除</a-button></a-popconfirm></template></a-space></template></a-table-column>
            </template>
            <template #empty><a-empty description="暂无回测策略，请先新建策略。" /></template>
          </a-table>
        </a-card>
      </a-tab-pane>
      <a-tab-pane key="debug" title="批量调试">
        <a-card class="debug-card" :bordered="false"><a-form :model="debugForm" layout="vertical">
          <div class="form-row"><a-form-item label="市场"><a-select v-model="debugForm.market"><a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option></a-select></a-form-item><a-form-item label="策略"><a-select v-model="debugForm.strategy"><a-option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategy.label || strategy.name }}</a-option></a-select></a-form-item></div>
          <div class="symbol-input-grid">
            <a-form-item label="搜索选择股票">
              <a-select v-model="selectedSymbols" multiple allow-search :filter-option="false" :loading="symbolSearching" placeholder="输入股票代码或名称远程搜索" @search="searchSymbols">
                <a-option v-for="item in remoteSymbolOptions" :key="item.symbol" :value="item.symbol"><span>{{ item.symbol }}</span><small class="symbol-option-name">{{ item.name || '未命名股票' }}</small></a-option>
              </a-select>
              <template #extra><div class="subscription-symbol-hint"><span>已选择 {{ selectedSymbols.length }} 只股票</span><a-button v-if="subscribedSymbols.length" type="text" size="mini" @click="useSubscribedSymbols">载入订阅股票</a-button></div></template>
            </a-form-item>
            <a-form-item label="批量输入股票代码">
              <a-textarea v-model="debugForm.symbolsText" placeholder="支持换行、逗号或空格分隔，例如：000021, 000725" :auto-size="{ minRows: 3, maxRows: 6 }" />
              <template #extra>搜索选择与批量输入会自动合并去重，共 {{ effectiveSymbols.length }} 只股票</template>
            </a-form-item>
          </div>
          <a-form-item label="回测日期范围"><a-range-picker v-model="dateRange" value-format="YYYY-MM-DD" style="width: 100%" /></a-form-item>
          <a-button type="primary" :loading="debugging" :disabled="!effectiveSymbols.length || !debugForm.start || !debugForm.end" @click="runBatch">批量运行回测</a-button>
        </a-form></a-card>
        <a-table v-if="batchResults.length" :data="batchResults" :pagination="false" row-key="symbol" class="result-table"><template #columns><a-table-column title="股票" data-index="symbol"/><a-table-column title="策略收益"><template #cell="{ record }">{{ record.ok ? pct(record.result.stats.total_return) : '失败' }}</template></a-table-column><a-table-column title="最大回撤"><template #cell="{ record }">{{ record.ok ? pct(record.result.stats.max_drawdown) : record.error }}</template></a-table-column><a-table-column title="胜率"><template #cell="{ record }">{{ record.ok ? pct(record.result.stats.win_rate) : '-' }}</template></a-table-column><a-table-column title="操作"><template #cell="{ record }"><a-button v-if="record.ok" type="text" @click="selectedResult = record.result">查看图表</a-button></template></a-table-column></template></a-table>
        <BacktestResults v-if="selectedResult" :result="selectedResult" :pct="pct" />
      </a-tab-pane>
      <a-tab-pane key="paper" title="模拟运行">
        <div class="paper-toolbar"><p>从任务创建时刻开始监听策略信号，按每只股票的独立资金池模拟成交。</p><a-button type="primary" @click="openPaperDrawer">新增模拟任务</a-button></div>
        <a-card v-for="run in paperRuns" :key="run.id" class="paper-card" :bordered="false">
          <div class="paper-grid"><a-input v-model="run.name" placeholder="任务名称"/><a-select v-model="run.strategy"><a-option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategy.label || strategy.name }}</a-option></a-select><a-input v-model="run.symbolsText" placeholder="600519, 000001"/><a-input-number v-model="run.intervalMinutes" :min="1"><template #suffix>分钟</template></a-input-number></div>
          <div class="paper-status"><a-badge :status="run.active ? 'processing' : 'default'" :text="run.status"/><span>最近运行：{{ run.lastRunAt || '—' }}</span><a-button size="small" @click="executePaperRun(run)">立即运行</a-button><a-button size="small" :status="run.active ? 'warning' : 'success'" @click="togglePaperRun(run)">{{ run.active ? '停止盯盘' : '启动盯盘' }}</a-button><a-button size="small" status="danger" @click="removePaperRun(run)">删除</a-button></div>
          <div v-if="run.accounts?.length" class="paper-account-list"><span v-for="account in run.accounts" :key="account.symbol"><strong>{{ account.symbol }}</strong>{{ account.name ? ` · ${account.name}` : '' }}<em>资金池 {{ Number(account.initialCapital).toLocaleString('zh-CN') }} · {{ account.lotSize }} 股/手</em></span></div>
          <div v-if="run.results?.length" class="paper-result-list"><span v-for="item in run.results" :key="item.symbol"><strong>{{ item.symbol }}</strong>：{{ item.lastOrder ? `${item.lastOrder.date} 模拟${item.lastOrder.side === 'buy' ? '买入' : '卖出'} @ ${Number(item.lastOrder.price).toFixed(2)}` : '暂无交易信号' }}</span></div>
        </a-card>
      </a-tab-pane>
    </a-tabs>
    <a-drawer v-model:visible="paperDrawerVisible" title="新建模拟任务" :width="620" :ok-button-props="{ disabled: !paperForm.accounts.some(item => item.selected) }" @ok="addPaperRun">
      <a-form :model="paperForm" layout="vertical" class="paper-create-form">
        <a-form-item label="任务名称"><a-input v-model="paperForm.name" maxlength="60" placeholder="例如：双均线订阅股模拟盘" /></a-form-item>
        <div class="form-row"><a-form-item label="市场"><a-select v-model="paperForm.market" @change="resetPaperAccounts"><a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option></a-select></a-form-item><a-form-item label="策略"><a-select v-model="paperForm.strategy"><a-option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategy.label || strategy.name }}</a-option></a-select></a-form-item></div>
        <div class="form-row"><a-form-item label="检查间隔"><a-input-number v-model="paperForm.intervalMinutes" :min="1"><template #suffix>分钟</template></a-input-number></a-form-item><a-form-item label="默认资金池"><a-input-number v-model="paperForm.defaultCapital" :min="1" :precision="2" @change="applyDefaultCapital"><template #prefix>¥</template></a-input-number></a-form-item></div>
        <div class="paper-stock-head"><div><strong>模拟股票与资金池</strong><small>A 股按 100 股整数倍，美股按 1 股整数倍模拟成交。</small></div><a-button size="mini" @click="applyDefaultCapital">统一应用资金</a-button></div>
        <div v-if="paperForm.accounts.length" class="paper-stock-list"><div v-for="account in paperForm.accounts" :key="account.symbol" class="paper-stock-row"><a-checkbox v-model="account.selected" /><div class="paper-stock-name"><strong>{{ account.symbol }}</strong><small>{{ account.name || '未命名股票' }}</small></div><a-input-number v-model="account.initialCapital" :min="1" :precision="2" :disabled="!account.selected"><template #prefix>¥</template></a-input-number><a-tag>{{ account.lotSize }} 股/手</a-tag></div></div>
        <a-empty v-else description="当前市场没有订阅股票，请先添加订阅。" />
      </a-form>
    </a-drawer>
    <a-modal v-model:visible="editorVisible" :title="editor.id ? '编辑回测策略' : '新建回测策略'" width="720px" :ok-loading="saving" @ok="saveStrategy"><a-form :model="editor" layout="vertical"><a-form-item label="策略名称"><a-input v-model="editor.name" maxlength="80"/></a-form-item><a-form-item label="策略说明"><a-input v-model="editor.description"/></a-form-item><a-form-item label="规则定义（JSON）"><a-textarea v-model="editor.definitionText" class="json-editor" :auto-size="{ minRows: 16, maxRows: 24 }"/></a-form-item></a-form></a-modal>
  </section>
</template>

<style scoped>
.strategy-workbench { display: grid; gap: 16px; }.workbench-head,.strategy-card-head,.card-actions,.paper-toolbar,.paper-status { display:flex;align-items:center;justify-content:space-between;gap:12px }.workbench-head h2{margin:0}.workbench-head p,.strategy-card p,.paper-toolbar p{color:#86909c}.strategy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}.strategy-card,.debug-card,.paper-card,.result-table{border:1px solid #e5e8ef;border-radius:14px}.strategy-card p{min-height:42px;line-height:1.7}.strategy-title{display:grid;gap:3px}.strategy-title small{color:#86909c;font-weight:400}.rule-summary{display:grid;gap:5px;border-radius:8px;padding:10px;background:#f7f8fa;color:#4e5969;font-size:12px;line-height:1.6}.rule-summary strong{color:#1d2129}.parameter-tags{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.card-actions{justify-content:flex-start}.form-row,.paper-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.result-table{margin:16px 0}.paper-card{margin-bottom:12px}.paper-grid{grid-template-columns:1fr 1fr 1.5fr 150px}.paper-status{justify-content:flex-end;margin-top:14px}.paper-status span{color:#86909c}.paper-result-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.paper-result-list span{padding:6px 10px;border-radius:8px;background:#f6f8fb;color:#4e5969;font-size:12px}.json-editor :deep(textarea){font-family:ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:760px){.paper-grid,.form-row{grid-template-columns:1fr}.paper-status,.workbench-head{align-items:flex-start;flex-wrap:wrap}}

.strategy-workbench { width: 100%; margin: 0; padding: 0 0 40px; gap: 18px; }
.workbench-head { min-height: 58px; border: 0; padding: 0; background: transparent; box-shadow: none; }
.workbench-head > div { display: grid; gap: 5px; }
.workbench-head h2 { color: var(--app-text-strong); font-size: 22px; letter-spacing: -.03em; }
.workbench-head p { margin: 0; color: var(--app-text-muted); font-size: 13px; }
.strategy-workbench :deep(.arco-tabs-nav) { margin-bottom: 16px; }
.strategy-workbench :deep(.arco-tabs-nav-tab-list) { gap: 5px; border: 1px solid var(--app-border); border-radius: 10px; padding: 4px; background: var(--app-surface); }
.strategy-workbench :deep(.arco-tabs-tab) { margin: 0; border-radius: 7px; padding: 7px 14px; color: var(--app-text-muted); }
.strategy-workbench :deep(.arco-tabs-tab:hover) { background: var(--app-hover); color: var(--app-text-secondary); }
.strategy-workbench :deep(.arco-tabs-tab-active) { background: var(--app-accent-bg); color: var(--app-accent-soft); }
.strategy-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
.strategy-stats :deep(.arco-card) { border-color: var(--app-border); border-radius: 10px; background: var(--app-surface); }
.strategy-table-card { overflow: hidden; border-color: var(--app-border) !important; border-radius: 12px; background: var(--app-surface) !important; }
.strategy-table-card :deep(.arco-card-body) { padding: 0; }
.strategy-table-card :deep(.arco-table-cell) { vertical-align: middle; }
.strategy-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
.strategy-name > div { display: grid; min-width: 0; gap: 3px; }
.strategy-name strong { overflow: hidden; color: var(--app-text-strong); text-overflow: ellipsis; white-space: nowrap; }
.strategy-name small { overflow: hidden; color: var(--app-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.strategy-mark { display: grid; width: 34px; height: 34px; flex: 0 0 34px; place-items: center; border-radius: 9px; background: var(--app-accent-bg); color: var(--app-accent-soft); font-weight: 700; }
.strategy-description, .rule-text { display: -webkit-box; overflow: hidden; color: var(--app-text-secondary); line-height: 1.6; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.parameter-tags.compact { margin: 0; gap: 5px; }
.parameter-tags.compact :deep(.arco-tag) { max-width: 105px; overflow: hidden; text-overflow: ellipsis; }
.muted-value { color: var(--app-text-muted); }
.subscription-symbol-hint { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; color: var(--app-text-muted); }
.subscription-symbol-hint :deep(.arco-btn) { padding-inline: 0; color: var(--app-accent-soft); }
.symbol-input-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.symbol-option-name { margin-left: 10px; color: var(--app-text-muted); }
.debug-card :deep(.arco-select-view-multiple) { min-height: 38px; background: var(--app-surface-raised); }
.strategy-grid { grid-template-columns: repeat(auto-fill, minmax(390px, 1fr)); gap: 16px; }
.strategy-card { border-color: var(--app-border) !important; background: var(--app-surface) !important; box-shadow: 0 9px 26px var(--app-shadow); transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.strategy-card:hover { border-color: var(--app-border-strong) !important; box-shadow: 0 14px 34px var(--app-shadow); transform: translateY(-2px); }
.strategy-card :deep(.arco-card-body) { display: grid; gap: 12px; padding: 18px; }
.strategy-card-head { align-items: flex-start; }
.strategy-title strong { color: var(--app-text-strong); font-size: 14px; }
.strategy-title small, .strategy-card p { color: var(--app-text-muted); }
.strategy-card p { min-height: 0; margin: 0; }
.rule-summary { gap: 7px; border: 1px solid var(--app-border); border-radius: 10px; padding: 12px 13px; background: var(--app-surface-raised); color: var(--app-text-secondary); }
.rule-summary strong { color: var(--app-text-strong); font-size: 11px; letter-spacing: .04em; }
.parameter-tags { margin: 0; }
.parameter-tags :deep(.arco-tag) { border: 1px solid var(--app-border); background: var(--app-surface-soft); color: var(--app-text-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.card-actions { border-top: 1px solid var(--app-border); padding-top: 12px; }
.card-actions :deep(.arco-btn-secondary) { border-color: var(--app-border); background: var(--app-surface-raised); color: var(--app-text-secondary); }
.card-actions :deep(.arco-btn-secondary:hover) { border-color: var(--app-border-strong); background: var(--app-hover); color: var(--app-text-strong); }
.debug-card, .paper-card, .result-table { border-color: var(--app-border) !important; background: var(--app-surface) !important; }
.paper-toolbar { border: 1px solid var(--app-border); border-radius: 10px; padding: 12px 14px; background: var(--app-surface); }
.paper-toolbar p { margin: 0; color: var(--app-text-muted); }
.paper-result-list span { border: 1px solid var(--app-border); background: var(--app-surface-soft); color: var(--app-text-secondary); }
.paper-account-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.paper-account-list span { display: grid; gap: 2px; border: 1px solid var(--app-border); border-radius: 8px; padding: 8px 10px; background: var(--app-surface-soft); color: var(--app-text-secondary); font-size: 12px; }
.paper-account-list em { color: var(--app-text-muted); font-style: normal; }
.paper-stock-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 6px 0 10px; }
.paper-stock-head > div, .paper-stock-name { display: grid; gap: 3px; }
.paper-stock-head small, .paper-stock-name small { color: var(--app-text-muted); }
.paper-stock-list { display: grid; gap: 8px; }
.paper-stock-row { display: grid; grid-template-columns: auto minmax(110px, 1fr) minmax(180px, 1.3fr) auto; align-items: center; gap: 10px; border: 1px solid var(--app-border); border-radius: 10px; padding: 10px 12px; background: var(--app-surface-soft); }
@media(max-width:980px){.strategy-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.symbol-input-grid{grid-template-columns:1fr}}
@media(max-width:700px){.strategy-workbench{padding-inline:0}.workbench-head{align-items:flex-start;flex-direction:column}.workbench-head :deep(.arco-btn){width:100%}.strategy-stats{grid-template-columns:1fr 1fr}.strategy-grid{grid-template-columns:1fr}.paper-stock-row{grid-template-columns:auto 1fr}.paper-stock-row :deep(.arco-input-wrapper),.paper-stock-row :deep(.arco-tag){grid-column:2}}
</style>
