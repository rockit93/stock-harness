<script setup>
import { computed, ref } from "vue";
import { IconStarFill } from "@arco-design/web-vue/es/icon";
import StockDetailDrawer from "./StockDetailDrawer.vue";

const props = defineProps({ subscriptions: { type: Array, default: () => [] }, fundamentals: { type: Object, default: () => ({}) }, chartData: { type: Object, default: () => ({}) }, currentPrices: { type: Object, default: () => ({}) }, labels: { type: Object, default: () => ({}) }, strategies: { type: Array, default: () => [] }, marketLabel: { type: Function, required: true }, marketColors: { type: Object, default: () => ({}) } });
defineEmits(["unsubscribe"]);
const detailVisible = ref(false); const selected = ref(null);
function view(record) { selected.value = record; detailVisible.value = true; }
const groups = computed(() => ["A Share", "Hong Kong", "US"].map((market) => ({ market, items: props.subscriptions.filter((item) => item.market === market) })).filter((group) => group.items.length));
function session(record, offset) {
  const bars = props.chartData[record.id] ?? [];
  const bar = bars[bars.length - 1 - offset];
  return bar ? `开 ${Number(bar.open).toFixed(2)} · 收 ${Number(bar.close).toFixed(2)}` : "-";
}
function price(record) {
  const item = props.currentPrices[record.id];
  return item ? Number(item.price).toFixed(2) : "-";
}
function hitLabels(record) {
  return [...new Set((props.labels[String(record.id)] ?? []).map((item) => item.latestLabel).filter(Boolean))];
}
</script>

<template>
  <section v-for="group in groups" :key="group.market" class="market-table-group">
  <h3>{{ marketLabel(group.market) }}</h3>
  <a-table class="subscription-table" :data="group.items" row-key="id" :pagination="false" :bordered="false" stripe :scroll="{ x: 1250 }">
    <template #columns>
      <a-table-column title="公司 / 代码" :width="210">
        <template #cell="{ record }"><strong>{{ record.stockName || record.name || marketLabel(record.market) }}</strong><code>{{ record.symbol }}</code></template>
      </a-table-column>
      <a-table-column title="市场" :width="100"><template #cell="{ record }">{{ marketLabel(record.market) }}</template></a-table-column>
      <a-table-column title="所属板块" :width="150"><template #cell="{ record }">{{ fundamentals[record.id]?.sector || fundamentals[record.id]?.industry || '暂无' }}</template></a-table-column>
      <a-table-column title="当前价" :width="130">
        <template #cell="{ record }"><div class="current-price"><strong>{{ price(record) }}</strong><a-badge :status="currentPrices[record.id]?.live ? 'processing' : 'default'" :text="currentPrices[record.id]?.live ? '分钟更新' : '最近价格'" /></div></template>
      </a-table-column>
      <a-table-column title="标签" :width="180">
        <template #cell="{ record }"><div class="stock-tags"><a-tag v-for="label in hitLabels(record)" :key="label" color="green">{{ label }}</a-tag><span v-if="!hitLabels(record).length">-</span></div></template>
      </a-table-column>
      <a-table-column v-for="index in 4" :key="index" :title="['营收', '净利润', 'ROE', '经营现金流'][index - 1]" :width="130">
        <template #cell="{ record }">{{ fundamentals[record.id]?.metrics?.[index - 1]?.display || '-' }}</template>
      </a-table-column>
      <a-table-column title="上个交易日" :width="180"><template #cell="{ record }">{{ session(record, 1) }}</template></a-table-column>
      <a-table-column title="最新交易日" :width="180"><template #cell="{ record }">{{ session(record, 0) }}</template></a-table-column>
      <a-table-column title="操作" :width="130" fixed="right">
        <template #cell="{ record }">
          <a-button type="text" size="small" @click="view(record)">查看</a-button>
          <a-popconfirm content="确定取消订阅这只股票吗？" ok-text="确定取消" cancel-text="保留" type="warning" @ok="$emit('unsubscribe', record.id)">
            <a-button class="star-button" type="text" shape="circle" title="取消订阅"><IconStarFill /></a-button>
          </a-popconfirm>
        </template>
      </a-table-column>
    </template>
  </a-table>
  </section>
  <StockDetailDrawer v-model:visible="detailVisible" :stock="selected" :bars="selected ? chartData[selected.id] || [] : []" :fundamentals="selected ? fundamentals[selected.id] : null" :labels="selected ? labels[String(selected.id)] || [] : []" :current-price="selected ? currentPrices[selected.id] : null" :strategies="strategies" :market-colors="marketColors" />
</template>

<style scoped>
.subscription-table { overflow: hidden; border: 1px solid #e5e8ef; border-radius: 12px; background: #fff; }
.market-table-group { margin-top: 18px; }.market-table-group h3 { margin: 0 0 9px; color: #1d2129; font-size: 15px; }
.subscription-table strong { margin-right: 8px; color: #1d2129; }
.subscription-table code { border-radius: 5px; padding: 2px 6px; background: #f2f5ff; color: #315efb; font-family: inherit; font-size: 11px; }
.star-button { color: #f59e0b; }
.current-price { display: grid; gap: 3px; }.current-price strong { margin: 0; font-size: 14px; }.current-price :deep(.arco-badge-status-text) { color: #86909c; font-size: 10px; }
.stock-tags { display: flex; gap: 4px; flex-wrap: wrap; }
</style>
