<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { dispose, init } from "klinecharts";
import { chartThemeStyles } from "../../chartTheme.js";

const props = defineProps({
  market: { type: String, required: true },
  symbol: { type: String, required: true },
  stock: { type: Object, default: null },
  labels: { type: Array, default: () => [] },
  request: { type: Function, required: true },
  marketColors: { type: Object, default: () => ({}) },
});

const loading = ref(false);
const error = ref("");
const bars = ref([]);
const fundamentals = ref(null);
const range = ref("year");
const interval = ref("1d");
const chartNode = ref(null);
let chart;

const marketName = computed(() => ({ "A Share": "A 股", "Hong Kong": "港股", US: "美股" })[props.market] || props.market);
const hitLabels = computed(() => [...new Set(props.labels.map((item) => item.latestLabel).filter(Boolean))]);
const latestBar = computed(() => bars.value.at(-1) || null);
const metrics = computed(() => fundamentals.value?.metrics || []);

function rangeStart() {
  const end = new Date();
  const start = new Date(end);
  const offsets = { day: 10, week: 30, month: 90, halfYear: 365, year: 730 };
  start.setDate(start.getDate() - offsets[range.value]);
  return start.toISOString().slice(0, 10);
}

function renderChart() {
  if (!chartNode.value || !bars.value.length) return;
  if (chart) dispose(chart);
  chart = init(chartNode.value, { locale: "zh-CN", timezone: props.market === "US" ? "America/New_York" : "Asia/Shanghai" });
  const redUp = props.marketColors[props.market] !== "green-up";
  const upColor = redUp ? "#ef4444" : "#16a34a";
  const downColor = redUp ? "#16a34a" : "#ef4444";
  const styles = chartThemeStyles();
  chart?.setStyles({
    ...styles,
    candle: { ...styles.candle, bar: { upColor, downColor, noChangeColor: "#94a3b8", upBorderColor: upColor, downBorderColor: downColor, upWickColor: upColor, downWickColor: downColor } },
  });
  chart?.setPriceVolumePrecision(2, 0);
  chart?.applyNewData(bars.value.map((row) => ({ timestamp: new Date(row.date).getTime(), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) })));
  chart?.createIndicator({ name: "VOL", shortName: "成交量" }, false, { height: 120, minHeight: 90, dragEnabled: true });
  chart?.createIndicator("MA", false, { id: "candle_pane" });
}

async function load() {
  loading.value = true;
  error.value = "";
  const end = new Date().toISOString().slice(0, 10);
  try {
    const [barResult, fundamentalResult] = await Promise.allSettled([
      props.request("/bars", { method: "POST", body: JSON.stringify({ market: props.market, symbol: props.symbol, start: rangeStart(), end, range: range.value, interval: interval.value, adjust: "qfq" }) }),
      props.request("/fundamentals", { method: "POST", body: JSON.stringify({ market: props.market, symbol: props.symbol }) }),
    ]);
    bars.value = barResult.status === "fulfilled" ? barResult.value.bars || [] : [];
    fundamentals.value = fundamentalResult.status === "fulfilled" ? fundamentalResult.value : null;
    if (barResult.status === "rejected") error.value = barResult.reason?.message || String(barResult.reason);
    await nextTick();
    renderChart();
  } finally {
    loading.value = false;
  }
}

watch(() => [props.market, props.symbol, range.value, interval.value], load, { immediate: true });
onBeforeUnmount(() => { if (chart) dispose(chart); });
</script>

<template>
  <section class="stock-workspace" v-loading="loading">
    <header class="stock-hero">
      <div><span class="stock-market">{{ marketName }}</span><h1>{{ stock?.stockName || stock?.name || symbol }} <small>{{ symbol }}</small></h1><p>{{ fundamentals?.sector || fundamentals?.industry || '公司行情与研究工作台' }}</p></div>
      <div class="quote-summary"><small>最新收盘</small><strong>{{ latestBar ? Number(latestBar.close).toFixed(2) : '—' }}</strong><span>{{ latestBar?.date || '暂无行情' }}</span></div>
    </header>

    <a-alert v-if="error" type="warning" closable>{{ error }}</a-alert>

    <div class="stock-metrics">
      <article v-for="metric in metrics" :key="metric.key"><small>{{ metric.label }}</small><strong>{{ metric.display || '—' }}</strong></article>
      <article v-if="!metrics.length"><small>基本面</small><strong>暂无数据</strong></article>
    </div>

    <div class="stock-layout">
      <a-card class="stock-chart-card" :bordered="false">
        <template #title><div class="stock-chart-title"><div><strong>K 线与成交量</strong><small>{{ marketName }} · {{ symbol }}</small></div><a-space class="stock-chart-controls"><a-select v-model="range" size="small" style="width: 110px"><a-option value="month">近一月</a-option><a-option value="halfYear">近半年</a-option><a-option value="year">近一年</a-option></a-select><a-select v-model="interval" size="small" style="width: 90px"><a-option value="1d">日 K</a-option><a-option value="1w">周 K</a-option><a-option value="1mo">月 K</a-option></a-select></a-space></div></template>
        <div v-if="bars.length" ref="chartNode" class="stock-kline"></div><a-empty v-else description="暂无 K 线数据" />
      </a-card>

      <aside class="stock-side">
        <a-card title="实时交易" :bordered="false"><a-empty description="当前数据源未提供实时报价与交易状态" /></a-card>
        <a-card title="买卖盘与逐笔成交" :bordered="false"><a-empty description="需要在行情路由中启用支持盘口的实时数据源" /></a-card>
      </aside>
    </div>

    <div class="stock-bottom-grid">
      <a-card title="公司资讯" :bordered="false"><a-empty description="资讯数据源尚未接入；后续将在此展示公告与新闻时间线" /></a-card>
      <a-card title="研究标签" :bordered="false"><a-space v-if="hitLabels.length" wrap><a-tag v-for="label in hitLabels" :key="label" color="green">{{ label }}</a-tag></a-space><a-empty v-else description="这只股票暂未命中标签" /></a-card>
    </div>
  </section>
</template>

<style scoped>
.stock-workspace{display:grid;gap:16px;padding-bottom:36px}.stock-hero{display:flex;align-items:center;justify-content:space-between;gap:20px;border:1px solid var(--app-border);border-radius:14px;padding:20px 22px;background:linear-gradient(135deg,var(--app-surface),var(--app-surface-raised));box-shadow:0 12px 32px var(--app-shadow)}.stock-hero h1{margin:6px 0 2px;color:var(--app-text-strong);font-size:26px}.stock-hero h1 small{margin-left:8px;color:var(--app-text-muted);font-size:14px}.stock-hero p{margin:0;color:var(--app-text-muted)}.stock-market{border-radius:999px;padding:3px 9px;background:var(--app-accent-bg);color:var(--app-accent-soft);font-size:12px}.quote-summary{display:grid;min-width:145px;text-align:right}.quote-summary small,.quote-summary span{color:var(--app-text-muted)}.quote-summary strong{color:var(--app-text-strong);font-size:30px}.stock-metrics{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:10px;overflow:auto}.stock-metrics article{display:grid;gap:4px;border:1px solid var(--app-border);border-radius:10px;padding:12px;background:var(--app-surface)}.stock-metrics small{color:var(--app-text-muted)}.stock-metrics strong{color:var(--app-text-strong)}.stock-layout{display:grid;grid-template-columns:minmax(0,2.25fr) minmax(300px,.75fr);gap:16px}.stock-side,.stock-bottom-grid{display:grid;gap:16px}.stock-bottom-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.stock-workspace :deep(.arco-card){border:1px solid var(--app-border);border-radius:12px;background:var(--app-surface)}.card-title{display:flex;align-items:center;justify-content:space-between;gap:12px}.card-title>div{display:grid;gap:3px}.card-title small{color:var(--app-text-muted)}.stock-kline{width:100%;height:610px;overflow:hidden;border:1px solid var(--app-border);border-radius:10px;background:var(--app-surface)}
.stock-chart-card :deep(.arco-card-header-title){width:100%;min-width:0;overflow:visible}.stock-chart-title{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-width:0;margin:0}.stock-chart-title>div{display:grid;gap:3px}.stock-chart-title small{color:var(--app-text-muted)}.stock-chart-controls{flex:0 0 auto}
@media(max-width:980px){.stock-layout{grid-template-columns:1fr}.stock-side{grid-template-columns:repeat(2,minmax(0,1fr))}.stock-metrics{grid-template-columns:repeat(4,minmax(120px,1fr))}}
@media(max-width:700px){.stock-hero{align-items:flex-start;flex-direction:column}.quote-summary{text-align:left}.stock-side,.stock-bottom-grid{grid-template-columns:1fr}.stock-chart-card :deep(.arco-card-header){height:auto;min-height:48px;padding-top:10px;padding-bottom:10px}.stock-chart-title{align-items:flex-start;flex-direction:column}.stock-chart-controls{width:100%}.stock-kline{height:480px}}
</style>
