<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { dispose, init } from "klinecharts";
import { chartThemeStyles } from "../../chartTheme.js";

const props = defineProps({ visible: Boolean, stock: Object, bars: { type: Array, default: () => [] }, fundamentals: Object, labels: { type: Array, default: () => [] }, currentPrice: Object, strategies: { type: Array, default: () => [] }, marketColors: { type: Object, default: () => ({}) } });
const emit = defineEmits(["update:visible"]);
const chartNode = ref(null);
const paperRuns = ref([]);
let chart;

const hitLabels = computed(() => [...new Set(props.labels.map((item) => item.latestLabel).filter(Boolean))]);
const boundRuns = computed(() => paperRuns.value.filter((run) => {
  const symbols = String(run.symbolsText || "").split(/[\s,，;；]+/).map((item) => item.trim().toUpperCase());
  return props.stock && run.market === props.stock.market && symbols.includes(String(props.stock.symbol).toUpperCase());
}).map((run) => ({ ...run, strategyName: props.strategies.find((item) => item.key === run.strategy)?.label || props.strategies.find((item) => item.key === run.strategy)?.name || run.strategy, result: (run.results || []).find((item) => item.symbol === props.stock?.symbol) })));

function renderChart() {
  if (!chartNode.value || !props.bars.length) return;
  if (chart) dispose(chart);
  chart = init(chartNode.value, { locale: "zh-CN", timezone: "Asia/Shanghai" });
  const redUp = props.marketColors[props.stock?.market] !== "green-up";
  const upColor = redUp ? "#ef4444" : "#16a34a";
  const downColor = redUp ? "#16a34a" : "#ef4444";
  chart?.setStyles({
    ...chartThemeStyles(),
    candle: { bar: { upColor, downColor, noChangeColor: "#94a3b8", upBorderColor: upColor, downBorderColor: downColor, upWickColor: upColor, downWickColor: downColor }, ...chartThemeStyles().candle },
    indicator: {
      bars: [{ upColor, downColor, noChangeColor: "#94a3b8" }],
      lines: [{ color: "#f4b740" }, { color: "#5b8ff9" }, { color: "#9b7bff" }],
    },
  });
  chart?.setPriceVolumePrecision(2, 0);
  chart?.applyNewData(props.bars.map((row) => ({ timestamp: new Date(row.date).getTime(), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) })));
  chart?.createIndicator({ name: "VOL", shortName: "成交量" }, false, { height: 118, minHeight: 88, dragEnabled: true });
}
watch(() => [props.visible, props.bars], async () => {
  if (!props.visible) return;
  paperRuns.value = JSON.parse(localStorage.getItem("stock-harness-paper-runs") || "[]");
  await nextTick(); renderChart();
}, { deep: true });
onBeforeUnmount(() => { if (chart) dispose(chart); });
</script>

<template>
  <a-drawer :visible="visible" :width="760" :footer="false" unmount-on-close @cancel="emit('update:visible', false)">
    <template #title>{{ stock?.stockName || stock?.name || '股票详情' }} · {{ stock?.symbol }}</template>
    <template v-if="stock">
      <div class="stock-summary"><div><small>当前价</small><strong>{{ currentPrice ? Number(currentPrice.price).toFixed(2) : '-' }}</strong></div><div><small>市场</small><strong>{{ stock.market }}</strong></div><div><small>所属板块</small><strong>{{ fundamentals?.sector || fundamentals?.industry || '暂无' }}</strong></div></div>
      <div class="drawer-section"><div class="section-head"><h3>K 线预览</h3><span>当前图表设置对应的行情区间</span></div><div v-if="bars.length" ref="chartNode" class="detail-kline"></div><a-empty v-else description="暂无 K 线数据" /></div>
      <div class="drawer-section"><div class="section-head"><h3>命中标签</h3></div><a-space wrap><a-tag v-for="label in hitLabels" :key="label" color="green">{{ label }}</a-tag><span v-if="!hitLabels.length">暂无命中标签</span></a-space></div>
      <div class="drawer-section"><div class="section-head"><h3>关联回测策略</h3><span>{{ boundRuns.length }} 个</span></div>
        <a-list v-if="boundRuns.length" :bordered="true"><a-list-item v-for="run in boundRuns" :key="run.id"><a-list-item-meta :title="run.name"><template #description>{{ run.strategyName }} · 每 {{ run.intervalMinutes }} 分钟 · {{ run.status }}<br/>最近运行：{{ run.lastRunAt || '尚未运行' }}<template v-if="run.result?.stats"> · 收益 {{ (Number(run.result.stats.total_return || 0) * 100).toFixed(2) }}%</template></template></a-list-item-meta><a-tag :color="run.active ? 'green' : 'gray'">{{ run.active ? '运行中' : '已停止' }}</a-tag></a-list-item></a-list>
        <a-empty v-else description="该股票暂未绑定回测模拟策略" />
      </div>
    </template>
  </a-drawer>
</template>

<style scoped>
.stock-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.stock-summary>div{display:grid;gap:5px;border-radius:8px;padding:12px;background:#f7f8fa}.stock-summary small,.section-head span{color:#86909c}.stock-summary strong{font-size:18px}.drawer-section{margin-top:22px}.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.section-head h3{margin:0}.detail-kline{width:100%;height:460px;border:1px solid #e5e6eb;border-radius:8px;overflow:hidden}
</style>
