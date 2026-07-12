<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import * as XLSX from "xlsx";
import BacktestResults from "./BacktestResults.vue";
import StockLink from "../stock/StockLink.vue";

const props = defineProps({
  strategies: { type: Array, default: () => [] },
  subscriptions: { type: Array, default: () => [] },
  request: { type: Function, required: true },
  pct: { type: Function, required: true },
  moduleMode: { type: String, default: "strategies" },
});
const emit = defineEmits(["refresh-strategies", "open-backtest"]);

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
const datasets = ref([]);
const datasetVisible = ref(false);
const datasetDetailVisible = ref(false);
const activeDataset = ref(null);
const datasetKeyword = ref("");
const datasetRows = ref([]);
const datasetColumns = ref([]);
const datasetRowsLoading = ref(false);
const datasetPage = ref(1);
const datasetImportVisible = ref(false);
const datasetImporting = ref(false);
const importFile = ref(null);
const importForm = reactive({ datasetId: null, mode: "file", symbolsText: "", start: "2023-01-01", end: new Date().toISOString().slice(0, 10) });
const datasetSaving = ref(false);
const selectedDatasetId = ref(null);
const datasetForm = reactive({ id: null, name: "", description: "", market: "A Share", symbolsText: "" });
let symbolSearchTimer = null;
let symbolSearchSequence = 0;
const editor = reactive({ id: null, name: "新回测策略", description: "", definitionText: "", definition: null });
const editorMode = ref("visual");
const editorError = ref("");
const indicatorTypes = [
  { value: "sma", label: "SMA · 简单移动平均" },
  { value: "ema", label: "EMA · 指数移动平均" },
  { value: "rsi", label: "RSI · 相对强弱指标" },
];
const operatorOptions = [
  { value: "crosses_above", label: "上穿" }, { value: "crosses_below", label: "下穿" },
  { value: ">", label: "大于" }, { value: ">=", label: "大于等于" },
  { value: "<", label: "小于" }, { value: "<=", label: "小于等于" },
  { value: "==", label: "等于" }, { value: "!=", label: "不等于" },
];
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
const filteredDatasetSymbols = computed(() => {
  const keyword = datasetKeyword.value.trim().toLowerCase();
  const list = activeDataset.value?.symbols || [];
  return keyword ? list.filter((symbol) => String(symbol).toLowerCase().includes(keyword)) : list;
});
const datasetTotalRows = computed(() => datasets.value.reduce((total, item) => total + Number(item.rowCount || 0), 0));
const datasetReadyCount = computed(() => datasets.value.filter((item) => Number(item.rowCount || 0) > 0).length);
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
async function loadDatasets() {
  datasets.value = await props.request("/backtest-datasets");
  const pendingId = Number(sessionStorage.getItem("alphadock-pending-backtest-dataset"));
  if (props.moduleMode === "strategies" && pendingId) {
    sessionStorage.removeItem("alphadock-pending-backtest-dataset");
    const dataset = datasets.value.find((item) => item.id === pendingId);
    if (dataset) await applyDataset(dataset);
  }
}
function openDataset(dataset = null) {
  Object.assign(datasetForm, dataset ? { ...dataset, symbolsText: dataset.symbols.join("\n") } : {
    id: null, name: "新回测数据集", description: "", market: debugForm.market, symbolsText: subscribedSymbols.value[0] || "",
  });
  datasetVisible.value = true;
}
async function loadDatasetRows(page = 1) {
  if (!activeDataset.value) return;
  datasetRowsLoading.value = true;
  try {
    const payload = await props.request(`/backtest-datasets/${activeDataset.value.id}/rows?page=${page}&pageSize=50`);
    datasetRows.value = payload.rows || []; datasetColumns.value = payload.dataset?.columns || []; datasetPage.value = payload.page || 1;
    activeDataset.value = payload.dataset;
  } finally { datasetRowsLoading.value = false; }
}
async function viewDataset(dataset) { activeDataset.value = dataset; datasetKeyword.value = ""; datasetDetailVisible.value = true; await loadDatasetRows(1); }
function openDatasetImport(dataset) {
  Object.assign(importForm, { datasetId: dataset.id, mode: "file", symbolsText: dataset.symbols.join("\n"), start: dataset.dateStart || "2023-01-01", end: dataset.dateEnd || new Date().toISOString().slice(0, 10) });
  importFile.value = null; activeDataset.value = dataset; datasetImportVisible.value = true;
}
function pickDatasetFile(event) { importFile.value = event.target.files?.[0] || null; }
async function parseImportFile(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd" });
  return { rows, columns: rows.length ? Object.keys(rows[0]) : [] };
}
async function importDatasetData() {
  datasetImporting.value = true;
  try {
    let rows = []; let columns = []; let sourceType = importForm.mode; let sourceName = "";
    if (importForm.mode === "file") {
      if (!importFile.value) return;
      ({ rows, columns } = await parseImportFile(importFile.value)); sourceType = /\.(csv|tsv)$/i.test(importFile.value.name) ? "csv" : "excel"; sourceName = importFile.value.name;
    } else {
      const payloads = await Promise.all(symbols(importForm.symbolsText).map(async (symbol) => {
        const payload = await props.request("/bars", { method: "POST", body: JSON.stringify({ market: activeDataset.value.market, symbol, start: importForm.start, end: importForm.end, interval: "1d", adjust: "qfq" }) });
        sourceName ||= payload.source || "当前行情路由"; return (payload.bars || []).map((row) => ({ symbol, ...row }));
      }));
      rows = payloads.flat(); columns = rows.length ? Object.keys(rows[0]) : []; sourceType = "data-source";
    }
    if (!rows.length) throw new Error("没有读取到可导入的数据行");
    await props.request(`/backtest-datasets/${importForm.datasetId}/import`, { method: "POST", body: JSON.stringify({ sourceType, sourceName, columns, rows }) });
    datasetImportVisible.value = false; await loadDatasets();
  } finally { datasetImporting.value = false; }
}
async function saveDataset() {
  const list = symbols(datasetForm.symbolsText);
  if (!datasetForm.name.trim() || list.length !== 1) return;
  datasetSaving.value = true;
  try {
    await props.request(datasetForm.id ? `/backtest-datasets/${datasetForm.id}` : "/backtest-datasets", {
      method: datasetForm.id ? "PUT" : "POST",
      body: JSON.stringify({ name: datasetForm.name, description: datasetForm.description, market: datasetForm.market, symbols: list }),
    });
    datasetVisible.value = false; await loadDatasets();
  } finally { datasetSaving.value = false; }
}
async function removeDataset(dataset) { await props.request(`/backtest-datasets/${dataset.id}`, { method: "DELETE" }); await loadDatasets(); }
async function applyDataset(dataset) {
  if (props.moduleMode === "datasets") {
    sessionStorage.setItem("alphadock-pending-backtest-dataset", String(dataset.id));
    emit("open-backtest"); return;
  }
  selectedDatasetId.value = dataset.id; debugForm.market = dataset.market; await nextTick();
  selectedSymbols.value = [...dataset.symbols]; debugForm.symbolsText = ""; mergeSymbolOptions(dataset.symbols.map((symbol) => ({ symbol, name: "", market: dataset.market })));
  tab.value = "debug";
}
function selectDataset(id) { const dataset = datasets.value.find((item) => item.id === id); if (dataset) applyDataset(dataset); }
watch([() => debugForm.market, () => props.subscriptions], useSubscribedSymbols, { immediate: true, deep: true });
const defaultDefinition = () => ({
  indicators: { fast: { type: "sma", period: 10 }, slow: { type: "sma", period: 30 } },
  entry: { all: [{ left: "fast", op: "crosses_above", right: "slow" }] },
  exit: { all: [{ left: "fast", op: "crosses_below", right: "slow" }] },
  risk: { stop_loss_pct: 0.08, take_profit_pct: 0.2 },
});
const strategyTemplates = [
  { key: "ma", label: "双均线交叉", definition: defaultDefinition },
  { key: "rsi", label: "RSI 均值回归", definition: () => ({
    indicators: { rsi14: { type: "rsi", period: 14 } },
    entry: { all: [{ left: "rsi14", op: "<", right: 30 }] },
    exit: { all: [{ left: "rsi14", op: ">", right: 60 }] },
    risk: { stop_loss_pct: 0.08, take_profit_pct: 0.2 },
  }) },
  { key: "ema", label: "EMA 趋势", definition: () => ({
    indicators: { fast: { type: "ema", period: 12 }, slow: { type: "ema", period: 26 } },
    entry: { all: [{ left: "fast", op: "crosses_above", right: "slow" }] },
    exit: { all: [{ left: "fast", op: "crosses_below", right: "slow" }] },
    risk: { stop_loss_pct: 0.06, take_profit_pct: 0.15 },
  }) },
];
const indicatorEntries = computed(() => Object.entries(editor.definition?.indicators || {}));
const operandOptions = computed(() => [
  { value: "close", label: "收盘价" },
  ...indicatorEntries.value.map(([key, value]) => ({ value: key, label: `${key} · ${String(value.type).toUpperCase()}(${value.period})` })),
]);
const generatedJson = computed(() => JSON.stringify(editor.definition ? definitionForSave() : {}, null, 2));

function cloneDefinition(value) { return JSON.parse(JSON.stringify(value)); }
function conditionRow(condition = {}) {
  const numeric = typeof condition.right === "number";
  return { left: condition.left || "close", op: condition.op || ">", rightKind: numeric ? "number" : "operand", right: numeric ? condition.right : (condition.right || "close") };
}
function normalizeForEditor(value) {
  const definition = cloneDefinition(value || defaultDefinition());
  definition.indicators ||= {};
  for (const side of ["entry", "exit"]) {
    const source = definition[side] || { all: [] };
    const mode = Object.prototype.hasOwnProperty.call(source, "any") ? "any" : "all";
    definition[side] = { mode, conditions: (source[mode] || []).map(conditionRow) };
  }
  definition.risk ||= {};
  return definition;
}
function definitionForSave() {
  const source = cloneDefinition(editor.definition);
  const definition = { indicators: source.indicators };
  for (const side of ["entry", "exit"]) {
    const group = source[side];
    definition[side] = { [group.mode]: group.conditions.map((item) => ({
      left: item.left, op: item.op, right: item.rightKind === "number" ? Number(item.right) : item.right,
    })) };
  }
  const risk = {};
  if (source.risk.stop_loss_pct !== undefined && source.risk.stop_loss_pct !== null) risk.stop_loss_pct = Number(source.risk.stop_loss_pct);
  if (source.risk.take_profit_pct !== undefined && source.risk.take_profit_pct !== null) risk.take_profit_pct = Number(source.risk.take_profit_pct);
  definition.risk = risk;
  return definition;
}
function applyTemplate(template) { editor.definition = normalizeForEditor(template.definition()); editorError.value = ""; }
function addIndicator() {
  let index = Object.keys(editor.definition.indicators).length + 1;
  while (editor.definition.indicators[`indicator${index}`]) index += 1;
  editor.definition.indicators[`indicator${index}`] = { type: "sma", period: 20 };
}
function renameIndicator(oldName, event) {
  const name = String(event?.target?.value || "").trim();
  if (!name || name === oldName || !/^[A-Za-z_]\w*$/.test(name) || editor.definition.indicators[name]) return;
  const entries = Object.entries(editor.definition.indicators).map(([key, value]) => [key === oldName ? name : key, value]);
  editor.definition.indicators = Object.fromEntries(entries);
  for (const side of ["entry", "exit"]) editor.definition[side].conditions.forEach((item) => {
    if (item.left === oldName) item.left = name;
    if (item.rightKind === "operand" && item.right === oldName) item.right = name;
  });
}
function removeIndicator(name) {
  if (Object.keys(editor.definition.indicators).length <= 1) return;
  delete editor.definition.indicators[name];
  for (const side of ["entry", "exit"]) editor.definition[side].conditions.forEach((item) => {
    if (item.left === name) item.left = "close";
    if (item.rightKind === "operand" && item.right === name) item.right = "close";
  });
}
function addCondition(side) { editor.definition[side].conditions.push(conditionRow({ left: "close", op: ">", right: 0 })); }
function switchEditorMode(mode) {
  editorError.value = "";
  if (mode === "json") editor.definitionText = JSON.stringify(definitionForSave(), null, 2);
  if (mode === "visual") {
    try { editor.definition = normalizeForEditor(JSON.parse(editor.definitionText)); }
    catch (error) { editorError.value = `JSON 无法解析：${error.message}`; return; }
  }
  editorMode.value = mode;
}
function validateDefinition(definition) {
  if (!editor.name.trim()) return "请填写策略名称";
  const indicators = Object.entries(definition.indicators || {});
  if (!indicators.length) return "至少需要一个指标";
  if (indicators.length > 20) return "指标不能超过 20 个";
  for (const [name, spec] of indicators) {
    if (!/^[A-Za-z_]\w*$/.test(name)) return `指标名“${name}”只能使用字母、数字和下划线，且不能以数字开头`;
    if (!Number.isInteger(spec.period) || spec.period < 2 || spec.period > 500) return `${name} 的周期必须是 2～500 的整数`;
  }
  if (!(definition.entry?.all?.length || definition.entry?.any?.length)) return "至少添加一条买入条件";
  if (!(definition.exit?.all?.length || definition.exit?.any?.length)) return "至少添加一条卖出条件";
  for (const key of ["stop_loss_pct", "take_profit_pct"]) {
    const value = definition.risk?.[key];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value >= 1)) return "止损和止盈比例必须大于 0 且小于 100%";
  }
  return "";
}

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
  const definition = strategy?.definition || defaultDefinition();
  Object.assign(editor, strategy ? {
    id: strategy.id, name: strategy.name, description: strategy.description || "", definitionText: JSON.stringify(definition, null, 2), definition: normalizeForEditor(definition),
  } : { id: null, name: "新回测策略", description: "", definitionText: JSON.stringify(definition, null, 2), definition: normalizeForEditor(definition) });
  editorMode.value = "visual";
  editorError.value = "";
  editorVisible.value = true;
}
async function saveStrategy() {
  try {
    const definition = editorMode.value === "json" ? JSON.parse(editor.definitionText) : definitionForSave();
    editorError.value = validateDefinition(definition);
    if (editorError.value) return;
    saving.value = true;
    await props.request(editor.id ? `/backtest-strategies/${editor.id}` : "/backtest-strategies", {
      method: editor.id ? "PUT" : "POST",
      body: JSON.stringify({ name: editor.name, description: editor.description, definition }),
    });
    editorVisible.value = false;
    emit("refresh-strategies");
  } catch (error) {
    editorError.value = error?.message || String(error);
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
  const endpoint = selectedDatasetId.value ? `/backtest-datasets/${selectedDatasetId.value}/backtest` : "/backtest";
  const settled = await Promise.allSettled(list.map((symbol) => props.request(endpoint, {
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
onMounted(loadDatasets);
</script>

<template>
  <section class="strategy-workbench">
    <header class="workbench-head"><div><h2>{{ moduleMode === 'datasets' ? '回测数据集' : '回测策略管理' }}</h2><p>{{ moduleMode === 'datasets' ? '管理可复用股票池，为不同策略提供一致的批量回测样本。' : '创建规则、批量验证，并将满意的策略投入模拟盯盘。' }}</p></div><a-button v-if="moduleMode === 'strategies'" type="primary" @click="openEditor()">新建策略</a-button><a-button v-else type="primary" @click="openDataset()">新建数据集</a-button></header>
    <a-tabs v-if="moduleMode === 'strategies'" v-model:active-key="tab" type="rounded">
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
      <a-tab-pane v-if="false" key="datasets" title="回测数据集">
        <div class="dataset-toolbar"><div><strong>可复用股票池</strong><p>保存一组同市场标的，供不同策略反复批量回测。</p></div><a-button type="primary" @click="openDataset()">新建数据集</a-button></div>
        <div v-if="datasets.length" class="dataset-grid">
          <a-card v-for="dataset in datasets" :key="dataset.id" class="dataset-card" :bordered="true">
            <header><div><strong>{{ dataset.name }}</strong><small>{{ dataset.description || '暂无说明' }}</small></div><a-tag>{{ dataset.market === 'A Share' ? 'A 股' : dataset.market === 'Hong Kong' ? '港股' : '美股' }}</a-tag></header>
            <div class="dataset-symbols"><a-tag v-for="symbol in dataset.symbols.slice(0, 10)" :key="symbol">{{ symbol }}</a-tag><span v-if="dataset.symbols.length > 10">+{{ dataset.symbols.length - 10 }}</span></div>
            <footer><span>{{ dataset.rowCount ? dataset.rowCount.toLocaleString('zh-CN') + ' 行' : '未导入明细' }}</span><a-space><a-button type="text" size="small" @click="viewDataset(dataset)">查看数据</a-button><a-button type="text" size="small" @click="openDatasetImport(dataset)">导入</a-button><a-button type="text" size="small" @click="applyDataset(dataset)">用于批量调试</a-button><a-button type="text" size="small" @click="openDataset(dataset)">编辑</a-button><a-popconfirm content="确定删除该数据集吗？" @ok="removeDataset(dataset)"><a-button type="text" size="small" status="danger">删除</a-button></a-popconfirm></a-space></footer>
          </a-card>
        </div>
        <a-empty v-else description="还没有回测数据集，请先创建一个可复用股票池。" />
      </a-tab-pane>
      <a-tab-pane key="debug" title="批量调试">
        <a-card class="debug-card" :bordered="false"><a-form :model="debugForm" layout="vertical">
          <a-form-item label="回测数据集"><a-select v-model="selectedDatasetId" allow-clear placeholder="可选：载入已保存的数据集" @change="selectDataset"><a-option v-for="dataset in datasets" :key="dataset.id" :value="dataset.id">{{ dataset.name }} · {{ dataset.symbols.length }} 只</a-option></a-select></a-form-item>
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
        <a-table v-if="batchResults.length" :data="batchResults" :pagination="false" row-key="symbol" class="result-table"><template #columns><a-table-column title="股票"><template #cell="{ record }"><StockLink :market="debugForm.market" :symbol="record.symbol" /></template></a-table-column><a-table-column title="策略收益"><template #cell="{ record }">{{ record.ok ? pct(record.result.stats.total_return) : '失败' }}</template></a-table-column><a-table-column title="最大回撤"><template #cell="{ record }">{{ record.ok ? pct(record.result.stats.max_drawdown) : record.error }}</template></a-table-column><a-table-column title="胜率"><template #cell="{ record }">{{ record.ok ? pct(record.result.stats.win_rate) : '-' }}</template></a-table-column><a-table-column title="操作"><template #cell="{ record }"><a-button v-if="record.ok" type="text" @click="selectedResult = record.result">查看图表</a-button></template></a-table-column></template></a-table>
        <BacktestResults v-if="selectedResult" :result="selectedResult" :pct="pct" />
      </a-tab-pane>
      <a-tab-pane key="paper" title="模拟运行">
        <div class="paper-toolbar"><p>从任务创建时刻开始监听策略信号，按每只股票的独立资金池模拟成交。</p><a-button type="primary" @click="openPaperDrawer">新增模拟任务</a-button></div>
        <a-card v-for="run in paperRuns" :key="run.id" class="paper-card" :bordered="false">
          <div class="paper-grid"><a-input v-model="run.name" placeholder="任务名称"/><a-select v-model="run.strategy"><a-option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategy.label || strategy.name }}</a-option></a-select><a-input v-model="run.symbolsText" placeholder="600519, 000001"/><a-input-number v-model="run.intervalMinutes" :min="1"><template #suffix>分钟</template></a-input-number></div>
          <div class="paper-status"><a-badge :status="run.active ? 'processing' : 'default'" :text="run.status"/><span>最近运行：{{ run.lastRunAt || '—' }}</span><a-button size="small" @click="executePaperRun(run)">立即运行</a-button><a-button size="small" :status="run.active ? 'warning' : 'success'" @click="togglePaperRun(run)">{{ run.active ? '停止盯盘' : '启动盯盘' }}</a-button><a-button size="small" status="danger" @click="removePaperRun(run)">删除</a-button></div>
          <div v-if="run.accounts?.length" class="paper-account-list"><span v-for="account in run.accounts" :key="account.symbol"><StockLink :market="run.market" :symbol="account.symbol" />{{ account.name ? ` · ${account.name}` : '' }}<em>资金池 {{ Number(account.initialCapital).toLocaleString('zh-CN') }} · {{ account.lotSize }} 股/手</em></span></div>
          <div v-if="run.results?.length" class="paper-result-list"><span v-for="item in run.results" :key="item.symbol"><StockLink :market="run.market" :symbol="item.symbol" />：{{ item.lastOrder ? `${item.lastOrder.date} 模拟${item.lastOrder.side === 'buy' ? '买入' : '卖出'} @ ${Number(item.lastOrder.price).toFixed(2)}` : '暂无交易信号' }}</span></div>
        </a-card>
      </a-tab-pane>
    </a-tabs>
    <template v-else>
      <a-alert type="info" class="dataset-model-tip">当前回测引擎按单个股票维护行情、持仓和撮合状态，因此一份数据集仅对应一个市场、一个股票代码和一套连续 K 线。</a-alert>
      <div class="dataset-overview">
        <a-card><small>数据集</small><strong>{{ datasets.length }}</strong><span>单标的历史样本</span></a-card>
        <a-card><small>已就绪</small><strong>{{ datasetReadyCount }}</strong><span>已导入行情明细</span></a-card>
        <a-card><small>总记录数</small><strong>{{ datasetTotalRows.toLocaleString('zh-CN') }}</strong><span>K 线数据行，并非固定 500 行</span></a-card>
      </div>
      <div class="dataset-toolbar"><div><strong>历史行情数据</strong><p>每份数据集独立对应一只股票，可重复用于不同策略的回测验证。</p></div></div>
      <div v-if="datasets.length" class="dataset-grid">
        <a-card v-for="dataset in datasets" :key="dataset.id" class="dataset-card" :bordered="true">
          <header><div><strong>{{ dataset.name }}</strong><small>{{ dataset.description || '暂无说明' }}</small></div><a-tag>{{ dataset.market === 'A Share' ? 'A 股' : dataset.market === 'Hong Kong' ? '港股' : '美股' }}</a-tag></header>
          <div class="dataset-primary-symbol"><span>{{ dataset.symbols[0] || '—' }}</span><div><small>股票代码</small><strong>{{ dataset.rowCount ? dataset.rowCount.toLocaleString('zh-CN') + ' 条 K 线' : '尚未导入行情' }}</strong></div></div>
          <div class="dataset-meta"><span><small>日期范围</small>{{ dataset.dateStart && dataset.dateEnd ? dataset.dateStart + ' ～ ' + dataset.dateEnd : '暂无' }}</span><span><small>数据来源</small>{{ dataset.sourceName || dataset.sourceType || '手工创建' }}</span></div>
          <footer><a-space><a-button type="primary" size="small" @click="viewDataset(dataset)">查看数据</a-button><a-button size="small" @click="openDatasetImport(dataset)">导入/更新</a-button><a-button size="small" @click="applyDataset(dataset)">去回测</a-button></a-space><a-space><a-button type="text" size="small" @click="openDataset(dataset)">编辑</a-button><a-popconfirm content="确定删除该数据集及全部行情明细吗？" @ok="removeDataset(dataset)"><a-button type="text" size="small" status="danger">删除</a-button></a-popconfirm></a-space></footer>
        </a-card>
      </div>
      <a-empty v-else description="还没有回测数据集，请为第一只股票创建历史行情数据集。" />
    </template>
    <a-modal v-model:visible="datasetDetailVisible" :title="activeDataset?.name || '数据集内容'" width="760px" :footer="false">
      <div v-if="activeDataset" class="dataset-detail">
        <div class="dataset-detail-summary"><div><span>来源</span><strong>{{ activeDataset.sourceName || activeDataset.sourceType || '手工创建' }}</strong></div><div><span>数据规模</span><strong>{{ Number(activeDataset.rowCount || 0).toLocaleString('zh-CN') }} 行 · {{ activeDataset.symbols.length }} 只</strong></div><div><span>日期范围</span><strong>{{ activeDataset.dateStart && activeDataset.dateEnd ? activeDataset.dateStart + ' ～ ' + activeDataset.dateEnd : '暂无明细' }}</strong></div></div>
        <section class="dataset-description"><strong>数据集说明</strong><p>{{ activeDataset.description || '暂无说明' }}</p></section>
        <div class="dataset-detail-head"><strong>底层数据预览</strong><a-tag>{{ activeDataset.columns.length }} 个字段</a-tag></div>
        <a-table v-if="datasetRows.length" :data="datasetRows" :loading="datasetRowsLoading" :pagination="false" :scroll="{ x: Math.max(760, datasetColumns.length * 130), y: 360 }" size="small"><template #columns><a-table-column v-for="column in datasetColumns" :key="column" :title="column" :data-index="column" :width="130" ellipsis tooltip /></template></a-table>
        <a-empty v-else description="尚未导入底层行情明细，请点击数据集卡片上的“导入”。" />
        <div v-if="activeDataset.rowCount > 50" class="dataset-pagination"><a-pagination :current="datasetPage" :total="activeDataset.rowCount" :page-size="50" simple @change="loadDatasetRows" /></div>
      </div>
    </a-modal>
    <a-modal v-model:visible="datasetImportVisible" title="导入回测数据" width="680px" :ok-loading="datasetImporting" @ok="importDatasetData">
      <a-form :model="importForm" layout="vertical">
        <a-alert type="info">标准行情字段建议包含 date、symbol、open、high、low、close、volume；也兼容常见中文字段名。</a-alert>
        <a-form-item label="导入方式"><a-radio-group v-model="importForm.mode" type="button"><a-radio value="file">CSV / Excel 文件</a-radio><a-radio value="data-source">当前数据源</a-radio></a-radio-group></a-form-item>
        <template v-if="importForm.mode === 'file'"><label class="dataset-file-picker"><input type="file" accept=".csv,.tsv,.xlsx,.xls" @change="pickDatasetFile"/><strong>{{ importFile?.name || '选择 CSV 或 Excel 文件' }}</strong><span>读取第一个工作表，单次最多导入 100,000 行</span></label></template>
        <template v-else><a-form-item label="股票代码"><a-textarea v-model="importForm.symbolsText" :auto-size="{ minRows: 5, maxRows: 10 }" placeholder="换行、逗号或空格分隔" /></a-form-item><a-form-item label="数据日期"><a-range-picker :model-value="[importForm.start, importForm.end]" value-format="YYYY-MM-DD" style="width:100%" @change="value => [importForm.start, importForm.end] = value" /></a-form-item></template>
      </a-form>
    </a-modal>
    <a-modal v-model:visible="datasetVisible" :title="datasetForm.id ? '编辑回测数据集' : '新建回测数据集'" :ok-loading="datasetSaving" :ok-button-props="{ disabled: !datasetForm.name.trim() || symbols(datasetForm.symbolsText).length !== 1 }" @ok="saveDataset">
      <a-form :model="datasetForm" layout="vertical">
        <a-alert type="info">一份数据集只保存一只股票，避免回测引擎在不同股票之间混用行情和持仓状态。</a-alert>
        <a-form-item label="数据集名称" required><a-input v-model="datasetForm.name" maxlength="80" placeholder="例如：深科技日线历史数据" /></a-form-item>
        <a-form-item label="市场"><a-select v-model="datasetForm.market"><a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option></a-select></a-form-item>
        <a-form-item label="说明"><a-input v-model="datasetForm.description" maxlength="200" placeholder="记录筛选口径、用途或更新时间" /></a-form-item>
        <a-form-item label="股票代码" required><a-input v-model="datasetForm.symbolsText" placeholder="例如：000021"/><template #extra>{{ symbols(datasetForm.symbolsText).length === 1 ? '将为该股票独立保存历史行情' : '请输入且仅输入一个股票代码' }}</template></a-form-item>
      </a-form>
    </a-modal>
    <a-drawer v-model:visible="paperDrawerVisible" title="新建模拟任务" :width="620" :ok-button-props="{ disabled: !paperForm.accounts.some(item => item.selected) }" @ok="addPaperRun">
      <a-form :model="paperForm" layout="vertical" class="paper-create-form">
        <a-form-item label="任务名称"><a-input v-model="paperForm.name" maxlength="60" placeholder="例如：双均线订阅股模拟盘" /></a-form-item>
        <div class="form-row"><a-form-item label="市场"><a-select v-model="paperForm.market" @change="resetPaperAccounts"><a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option></a-select></a-form-item><a-form-item label="策略"><a-select v-model="paperForm.strategy"><a-option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategy.label || strategy.name }}</a-option></a-select></a-form-item></div>
        <div class="form-row"><a-form-item label="检查间隔"><a-input-number v-model="paperForm.intervalMinutes" :min="1"><template #suffix>分钟</template></a-input-number></a-form-item><a-form-item label="默认资金池"><a-input-number v-model="paperForm.defaultCapital" :min="1" :precision="2" @change="applyDefaultCapital"><template #prefix>¥</template></a-input-number></a-form-item></div>
        <div class="paper-stock-head"><div><strong>模拟股票与资金池</strong><small>A 股按 100 股整数倍，美股按 1 股整数倍模拟成交。</small></div><a-button size="mini" @click="applyDefaultCapital">统一应用资金</a-button></div>
        <div v-if="paperForm.accounts.length" class="paper-stock-list"><div v-for="account in paperForm.accounts" :key="account.symbol" class="paper-stock-row"><a-checkbox v-model="account.selected" /><div class="paper-stock-name"><StockLink :market="paperForm.market" :symbol="account.symbol" /><small>{{ account.name || '未命名股票' }}</small></div><a-input-number v-model="account.initialCapital" :min="1" :precision="2" :disabled="!account.selected"><template #prefix>¥</template></a-input-number><a-tag>{{ account.lotSize }} 股/手</a-tag></div></div>
        <a-empty v-else description="当前市场没有订阅股票，请先添加订阅。" />
      </a-form>
    </a-drawer>
    <a-modal v-model:visible="editorVisible" :title="editor.id ? '编辑回测策略' : '新建回测策略'" width="1040px" modal-class="strategy-editor-modal" :ok-loading="saving" @ok="saveStrategy">
      <a-form :model="editor" layout="vertical" class="strategy-editor">
        <div class="editor-intro"><div><strong>用条件积木搭建策略</strong><span>当前由 Backtrader 执行，保存内容为可迁移的 JSON 规则。</span></div><a-tag color="arcoblue">做多 · 单标的</a-tag></div>
        <div class="editor-basics"><a-form-item label="策略名称"><a-input v-model="editor.name" maxlength="80" placeholder="例如：稳健双均线"/></a-form-item><a-form-item label="策略说明"><a-input v-model="editor.description" placeholder="记录策略思路和适用行情"/></a-form-item></div>
        <div class="editor-mode-bar"><a-radio-group :model-value="editorMode" type="button" @change="switchEditorMode"><a-radio value="visual">可视化配置</a-radio><a-radio value="json">高级 JSON</a-radio></a-radio-group><span>指标和条件会自动转换为后端兼容 JSON</span></div>

        <template v-if="editorMode === 'visual' && editor.definition">
          <section class="template-strip"><strong>从模板开始</strong><a-button v-for="template in strategyTemplates" :key="template.key" size="small" @click="applyTemplate(template)">{{ template.label }}</a-button></section>
          <div class="visual-editor-grid">
            <div class="editor-column">
              <section class="builder-section">
                <header><div><b>1</b><span><strong>技术指标</strong><small>给指标命名，然后设置类型和周期</small></span></div><a-button size="small" :disabled="indicatorEntries.length >= 20" @click="addIndicator">添加指标</a-button></header>
                <div class="indicator-list">
                  <div v-for="([name, spec]) in indicatorEntries" :key="name" class="indicator-row">
                    <a-input :model-value="name" placeholder="指标名称" @blur="renameIndicator(name, $event)" />
                    <a-select v-model="spec.type"><a-option v-for="item in indicatorTypes" :key="item.value" :value="item.value">{{ item.label }}</a-option></a-select>
                    <a-input-number v-model="spec.period" :min="2" :max="500" :precision="0"><template #suffix>周期</template></a-input-number>
                    <a-button type="text" status="danger" :disabled="indicatorEntries.length <= 1" @click="removeIndicator(name)">删除</a-button>
                  </div>
                </div>
              </section>

              <section v-for="side in ['entry', 'exit']" :key="side" class="builder-section condition-section">
                <header><div><b>{{ side === 'entry' ? 2 : 3 }}</b><span><strong>{{ side === 'entry' ? '买入条件' : '卖出条件' }}</strong><small>{{ side === 'entry' ? '空仓时满足条件，将买入' : '持仓时满足条件，将平仓' }}</small></span></div><a-button size="small" @click="addCondition(side)">添加条件</a-button></header>
                <div class="logic-mode"><span>以下条件</span><a-radio-group v-model="editor.definition[side].mode" type="button" size="small"><a-radio value="all">全部满足</a-radio><a-radio value="any">任一满足</a-radio></a-radio-group></div>
                <div class="condition-list">
                  <div v-for="(condition, index) in editor.definition[side].conditions" :key="index" class="condition-row">
                    <a-select v-model="condition.left"><a-option v-for="item in operandOptions" :key="item.value" :value="item.value">{{ item.label }}</a-option></a-select>
                    <a-select v-model="condition.op"><a-option v-for="item in operatorOptions" :key="item.value" :value="item.value">{{ item.label }}</a-option></a-select>
                    <a-select v-model="condition.rightKind" class="right-kind"><a-option value="operand">价格/指标</a-option><a-option value="number">数值</a-option></a-select>
                    <a-select v-if="condition.rightKind === 'operand'" v-model="condition.right"><a-option v-for="item in operandOptions" :key="item.value" :value="item.value">{{ item.label }}</a-option></a-select>
                    <a-input-number v-else v-model="condition.right" placeholder="阈值" />
                    <a-button type="text" status="danger" :disabled="editor.definition[side].conditions.length <= 1" @click="editor.definition[side].conditions.splice(index, 1)">删除</a-button>
                  </div>
                </div>
              </section>

              <section class="builder-section risk-section">
                <header><div><b>4</b><span><strong>风险控制</strong><small>触发任一条件都会立即平仓</small></span></div></header>
                <div class="risk-grid"><a-form-item label="固定止损"><a-input-number v-model="editor.definition.risk.stop_loss_pct" :min="0.001" :max="0.999" :step="0.01"><template #suffix>比例</template></a-input-number><template #extra>0.08 表示亏损 8% 止损</template></a-form-item><a-form-item label="固定止盈"><a-input-number v-model="editor.definition.risk.take_profit_pct" :min="0.001" :max="0.999" :step="0.01"><template #suffix>比例</template></a-input-number><template #extra>0.20 表示盈利 20% 止盈</template></a-form-item></div>
              </section>
            </div>
            <aside class="json-preview"><header><strong>实时生成的 JSON</strong><span>只读预览</span></header><pre>{{ generatedJson }}</pre></aside>
          </div>
        </template>
        <section v-else class="advanced-json"><div class="advanced-notice"><strong>高级模式</strong><span>仅支持 SMA、EMA、RSI 及当前条件运算符；切回可视化模式时会重新解析。</span></div><a-textarea v-model="editor.definitionText" class="json-editor" :auto-size="{ minRows: 22, maxRows: 30 }"/></section>
        <a-alert v-if="editorError" type="error" :show-icon="true">{{ editorError }}</a-alert>
      </a-form>
    </a-modal>
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
.dataset-toolbar { display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px }.dataset-toolbar>div{display:grid;gap:4px}.dataset-toolbar strong{color:var(--app-text-strong);font-size:16px}.dataset-toolbar p{margin:0;color:var(--app-text-muted)}
.dataset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}.dataset-card{border-color:var(--app-border)!important;background:var(--app-surface)!important}.dataset-card header,.dataset-card footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.dataset-card header>div{display:grid;gap:4px}.dataset-card header strong{color:var(--app-text-strong)}.dataset-card header small,.dataset-card footer>span{color:var(--app-text-muted)}.dataset-symbols{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-height:68px;margin:16px 0;padding:12px;border-radius:8px;background:var(--app-surface-muted)}.dataset-symbols>span{color:var(--app-text-muted);font-size:12px}
.dataset-model-tip{margin-bottom:16px}.dataset-overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:20px}.dataset-overview :deep(.arco-card){border-color:var(--app-border);background:var(--app-surface)}.dataset-overview :deep(.arco-card-body){display:grid;gap:5px}.dataset-overview small,.dataset-overview span{color:var(--app-text-muted)}.dataset-overview strong{color:var(--app-text-strong);font-size:26px}.dataset-card{box-shadow:0 8px 24px var(--app-shadow);transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}.dataset-card:hover{border-color:var(--app-border-strong)!important;box-shadow:0 14px 32px var(--app-shadow);transform:translateY(-2px)}.dataset-card :deep(.arco-card-body){display:grid;gap:16px;padding:18px}.dataset-primary-symbol{display:flex;align-items:center;gap:13px;padding:15px;border:1px solid var(--app-border);border-radius:10px;background:var(--app-surface-muted)}.dataset-primary-symbol>span{display:grid;min-width:74px;height:38px;place-items:center;border-radius:8px;background:var(--app-accent-bg);color:var(--app-accent-soft);font-weight:700;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.dataset-primary-symbol>div{display:grid;gap:3px}.dataset-primary-symbol small,.dataset-meta small{color:var(--app-text-muted);font-size:11px}.dataset-primary-symbol strong{color:var(--app-text-strong)}.dataset-meta{display:grid;grid-template-columns:1.2fr .8fr;gap:10px}.dataset-meta>span{display:grid;gap:4px;min-width:0;color:var(--app-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dataset-card footer{padding-top:14px;border-top:1px solid var(--app-border)}
.dataset-detail{display:grid;gap:18px}.dataset-detail-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dataset-detail-summary>div{display:grid;gap:6px;padding:14px;border:1px solid var(--app-border);border-radius:10px;background:var(--app-surface-muted)}.dataset-detail-summary span,.dataset-detail-tip{color:var(--app-text-muted);font-size:12px}.dataset-detail-summary strong,.dataset-description strong,.dataset-detail-head strong{color:var(--app-text-strong)}.dataset-description{padding:14px;border-left:3px solid var(--app-accent);background:var(--app-accent-bg)}.dataset-description p{margin:6px 0 0;color:var(--app-text-secondary);line-height:1.6}.dataset-detail-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.dataset-detail-symbols{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:360px;overflow:auto;padding:2px}.dataset-detail-symbols button{border:1px solid var(--app-border);border-radius:8px;padding:9px 10px;background:var(--app-surface);color:var(--app-text-secondary);font:inherit;cursor:pointer}.dataset-detail-symbols button:hover,.dataset-detail-symbols button:focus-visible{border-color:var(--app-accent);background:var(--app-accent-bg);color:var(--app-accent-soft);outline:none}.dataset-detail-tip{text-align:right}
.dataset-pagination{display:flex;justify-content:flex-end}.dataset-file-picker{display:grid;place-items:center;gap:8px;border:1px dashed var(--app-border-strong);border-radius:10px;padding:32px;background:var(--app-surface-muted);color:var(--app-text-muted);cursor:pointer}.dataset-file-picker:hover{border-color:var(--app-accent);background:var(--app-accent-bg)}.dataset-file-picker input{position:absolute;width:1px;height:1px;opacity:0}.dataset-file-picker strong{color:var(--app-text-strong)}
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
.strategy-editor { display: grid; gap: 14px; }
.editor-intro, .editor-mode-bar, .template-strip, .builder-section > header, .json-preview > header, .advanced-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.editor-intro { border: 1px solid var(--app-border); border-radius: 10px; padding: 12px 14px; background: var(--app-accent-bg); }
.editor-intro > div, .advanced-notice { display: grid; gap: 3px; }
.editor-intro strong, .builder-section strong, .json-preview strong, .advanced-notice strong { color: var(--app-text-strong); }
.editor-intro span, .editor-mode-bar > span, .builder-section small, .json-preview header span, .advanced-notice span { color: var(--app-text-muted); font-size: 12px; }
.editor-basics { display: grid; grid-template-columns: .8fr 1.2fr; gap: 12px; }
.editor-basics :deep(.arco-form-item) { margin-bottom: 0; }
.editor-mode-bar { border-bottom: 1px solid var(--app-border); padding-bottom: 12px; }
.template-strip { justify-content: flex-start; border: 1px dashed var(--app-border-strong); border-radius: 10px; padding: 10px 12px; background: var(--app-surface-soft); }
.template-strip strong { margin-right: 4px; color: var(--app-text-secondary); font-size: 12px; }
.visual-editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; align-items: start; gap: 14px; }
.editor-column { display: grid; gap: 12px; min-width: 0; }
.builder-section { border: 1px solid var(--app-border); border-radius: 12px; padding: 14px; background: var(--app-surface); }
.builder-section > header { margin-bottom: 12px; }
.builder-section > header > div { display: flex; align-items: center; gap: 10px; }
.builder-section > header b { display: grid; width: 26px; height: 26px; flex: 0 0 26px; place-items: center; border-radius: 8px; background: var(--app-accent-bg); color: var(--app-accent-soft); }
.builder-section > header span { display: grid; gap: 2px; }
.indicator-list, .condition-list { display: grid; gap: 8px; }
.indicator-row { display: grid; grid-template-columns: 1fr 1.45fr 130px auto; gap: 8px; }
.logic-mode { display: flex; align-items: center; gap: 10px; margin: -3px 0 10px 36px; color: var(--app-text-muted); font-size: 12px; }
.condition-row { display: grid; grid-template-columns: 1.1fr 110px 105px 1.1fr auto; gap: 8px; }
.risk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.risk-grid :deep(.arco-form-item) { margin-bottom: 0; }
.json-preview { position: sticky; top: 10px; overflow: hidden; border: 1px solid var(--app-border); border-radius: 12px; background: var(--app-surface-raised); }
.json-preview > header { border-bottom: 1px solid var(--app-border); padding: 11px 12px; }
.json-preview pre { overflow: auto; max-height: 610px; margin: 0; padding: 14px; color: var(--app-text-secondary); font: 11px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.advanced-json { display: grid; gap: 10px; }
.advanced-notice { align-items: flex-start; justify-content: center; border: 1px solid var(--app-border); border-radius: 10px; padding: 10px 12px; background: var(--app-surface-soft); }
.json-editor :deep(textarea) { background: var(--app-surface-raised); color: var(--app-text-secondary); }
@media(max-width:980px){.strategy-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.symbol-input-grid{grid-template-columns:1fr}}
@media(max-width:980px){.visual-editor-grid{grid-template-columns:1fr}.json-preview{position:static}.json-preview pre{max-height:300px}}
@media(max-width:700px){.strategy-workbench{padding-inline:0}.workbench-head,.dataset-toolbar{align-items:flex-start;flex-direction:column}.workbench-head :deep(.arco-btn),.dataset-toolbar :deep(.arco-btn){width:100%}.strategy-stats{grid-template-columns:1fr 1fr}.dataset-overview{grid-template-columns:1fr}.strategy-grid,.dataset-grid{grid-template-columns:1fr}.dataset-card footer{align-items:stretch;flex-direction:column}.dataset-card footer :deep(.arco-space){flex-wrap:wrap}.dataset-detail-summary{grid-template-columns:1fr}.dataset-detail-head{align-items:stretch;flex-direction:column}.dataset-detail-head :deep(.arco-input-wrapper){width:100%!important}.paper-stock-row{grid-template-columns:auto 1fr}.paper-stock-row :deep(.arco-input-wrapper),.paper-stock-row :deep(.arco-tag){grid-column:2}.editor-basics,.risk-grid{grid-template-columns:1fr}.editor-mode-bar,.editor-intro{align-items:flex-start;flex-direction:column}.template-strip{align-items:flex-start;flex-wrap:wrap}.indicator-row{grid-template-columns:1fr 1fr}.indicator-row :deep(.arco-btn){justify-self:start}.condition-row{grid-template-columns:1fr 1fr}.condition-row .right-kind{grid-column:1}.condition-row :deep(.arco-btn){justify-self:start}}
</style>
