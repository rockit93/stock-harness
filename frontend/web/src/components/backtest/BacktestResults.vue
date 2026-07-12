<script setup>
import { computed } from "vue";
import { IconExperiment, IconQuestionCircle } from "@arco-design/web-vue/es/icon";
import UnifiedTimeSeriesChart from "../charts/UnifiedTimeSeriesChart.vue";

const props = defineProps({ result: { type: Object, default: null }, pct: { type: Function, required: true } });
const equitySeries = computed(() => props.result ? [
  {
    name: "策略",
    color: "#2563eb",
    data: props.result.equity.map((row) => ({ time: row.date, value: row.value })),
    markers: (props.result.orders || []).map((order) => ({
      time: order.date,
      position: order.side === "buy" ? "belowBar" : "aboveBar",
      color: order.side === "buy" ? "#16a34a" : "#dc2626",
      shape: order.side === "buy" ? "arrowUp" : "arrowDown",
      text: order.side === "buy" ? "模拟买入" : "模拟卖出",
    })),
  },
  { name: "买入持有", color: "#f97316", data: props.result.benchmark_equity.map((row) => ({ time: row.date, value: row.value })) },
] : []);
const drawdownSeries = computed(() => props.result ? [{
  name: "回撤",
  type: "area",
  color: "#dc2626",
  topColor: "rgba(220, 38, 38, 0.08)",
  bottomColor: "rgba(220, 38, 38, 0.32)",
  data: props.result.drawdown.map((row) => ({ time: row.date, value: row.value * 100 })),
}] : []);
const metrics = [
  ["total_return", "策略总收益", "策略期末相对初始资金的累计涨跌幅，已计入手续费。"],
  ["benchmark_return", "买入持有", "同期买入标的并一直持有的累计收益。"],
  ["annualized_return", "年化收益", "将回测期收益折算为平均每年的复合收益率。"],
  ["max_drawdown", "最大回撤", "权益从历史高点到之后最低点的最大跌幅。"],
];
</script>

<template>
  <div class="results-panel">
    <template v-if="result">
      <section class="result-metrics">
        <a-card v-for="metric in metrics" :key="metric[0]" class="metric-card" :bordered="false">
          <span>{{ metric[1] }} <a-tooltip :content="metric[2]"><IconQuestionCircle /></a-tooltip></span>
          <strong>{{ pct(result.stats[metric[0]]) }}</strong>
        </a-card>
        <a-card class="metric-card" :bordered="false"><span>夏普比率</span><strong>{{ Number(result.stats.sharpe).toFixed(2) }}</strong></a-card>
        <a-card class="metric-card" :bordered="false"><span>交易次数</span><strong>{{ result.stats.trade_count }}</strong></a-card>
      </section>
      <section class="result-charts">
        <a-card class="chart-card" title="权益曲线" :bordered="false"><UnifiedTimeSeriesChart :series="equitySeries" value-format="currency" /></a-card>
        <a-card class="chart-card" title="回撤（%）" :bordered="false"><UnifiedTimeSeriesChart :series="drawdownSeries" value-format="percent" /></a-card>
      </section>
    </template>
    <a-card v-else class="empty-card" :bordered="false">
      <a-empty description="配置左侧参数后运行回测">
        <template #image><div class="empty-icon"><IconExperiment /></div></template>
      </a-empty>
      <p>回测完成后，这里会展示收益指标、权益曲线和回撤分析。</p>
    </a-card>
  </div>
</template>

<style scoped>
.results-panel { min-width: 0; }
.result-metrics { display: grid; grid-template-columns: repeat(3, minmax(140px, 1fr)); gap: 12px; margin-bottom: 16px; }
.metric-card { border: 1px solid #e5e8ef; border-radius: 12px; box-shadow: 0 5px 18px rgba(29, 33, 41, .035); }
.metric-card span { display: flex; align-items: center; gap: 5px; color: #86909c; font-size: 12px; }
.metric-card strong { display: block; margin-top: 10px; color: #1d2129; font-size: 24px; font-weight: 650; }
.result-charts { display: grid; grid-template-columns: 1fr; gap: 16px; }
.chart-card, .empty-card { border: 1px solid #e5e8ef; border-radius: 14px; box-shadow: 0 8px 28px rgba(29, 33, 41, .04); }
.empty-card { display: grid; min-height: 360px; place-items: center; }
.empty-card :deep(.arco-card-body) { text-align: center; }
.empty-card p { margin: 14px 0 0; color: #a0a7b4; font-size: 13px; }
.empty-icon { display: grid; width: 68px; height: 68px; place-items: center; border-radius: 20px; background: linear-gradient(145deg, #edf3ff, #f4f0ff); color: #4b72f2; font-size: 30px; }

@media (max-width: 1100px) { .result-metrics { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) { .result-metrics { grid-template-columns: 1fr; } }
</style>
