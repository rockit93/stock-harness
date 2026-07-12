<script setup>
import { computed, ref, watch } from "vue";
import { IconDelete, IconSearch, IconStar } from "@arco-design/web-vue/es/icon";

const props = defineProps({
  visible: { type: Boolean, default: false },
  subscriptions: { type: Array, default: () => [] },
  searchSymbols: { type: Function, required: true },
  loading: { type: Boolean, default: false },
});
const emit = defineEmits(["update:visible", "confirm"]);
const market = ref("A Share");
const keyword = ref("");
const searching = ref(false);
const results = ref([]);
const selected = ref([]);
const subscribedKeys = computed(() => new Set(props.subscriptions.map((item) => `${item.market}:${item.symbol}`)));

watch(() => props.visible, (visible) => {
  if (!visible) return;
  keyword.value = "";
  results.value = [];
  selected.value = [];
});

async function search() {
  if (!keyword.value.trim()) return;
  searching.value = true;
  try { results.value = await props.searchSymbols(market.value, keyword.value.trim()); }
  finally { searching.value = false; }
}

function add(item) {
  const key = `${item.market}:${item.symbol}`;
  if (subscribedKeys.value.has(key) || selected.value.some((entry) => `${entry.market}:${entry.symbol}` === key)) return;
  selected.value.push({ market: item.market, symbol: item.symbol, stockName: item.name, remark: "" });
}
</script>

<template>
  <a-drawer :visible="visible" :width="560" title="添加股票订阅" :footer="false" unmount-on-close @cancel="emit('update:visible', false)">
    <p class="drawer-intro">搜索并选择多只股票，确认后一次加入订阅。</p>
    <div class="search-row">
      <a-select v-model="market" style="width: 118px"><a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option></a-select>
      <a-input-search v-model="keyword" placeholder="股票代码或公司名称" search-button :loading="searching" @search="search" @press-enter="search"><template #button-icon><IconSearch /></template></a-input-search>
    </div>

    <div class="result-list">
      <a-empty v-if="!results.length" description="输入股票代码或名称开始搜索" />
      <button v-for="item in results" :key="item.market + item.symbol" type="button" class="result-item" :disabled="subscribedKeys.has(item.market + ':' + item.symbol) || selected.some((entry) => entry.market === item.market && entry.symbol === item.symbol)" @click="add(item)">
        <span><strong>{{ item.name }}</strong><code>{{ item.symbol }}</code></span>
        <small>{{ item.market === 'A Share' ? 'A 股' : item.market === 'Hong Kong' ? '港股' : '美股' }}</small>
        <b>{{ subscribedKeys.has(item.market + ':' + item.symbol) ? '已订阅' : '添加' }}</b>
      </button>
    </div>

    <a-divider>待订阅 · {{ selected.length }}</a-divider>
    <div class="selected-list">
      <a-empty v-if="!selected.length" description="尚未选择股票" />
      <div v-for="(item, index) in selected" :key="item.market + item.symbol" class="selected-item">
        <div><strong>{{ item.stockName }}</strong><code>{{ item.symbol }}</code></div>
        <a-input v-model="item.remark" size="small" placeholder="备注，可选" />
        <a-button type="text" status="danger" shape="circle" @click="selected.splice(index, 1)"><IconDelete /></a-button>
      </div>
    </div>

    <div class="drawer-actions">
      <a-button @click="emit('update:visible', false)">取消</a-button>
      <a-button type="primary" :disabled="!selected.length" :loading="loading" @click="emit('confirm', selected)"><template #icon><IconStar /></template>确认订阅 {{ selected.length ? `(${selected.length})` : '' }}</a-button>
    </div>
  </a-drawer>
</template>

<style scoped>
.drawer-intro { margin: -4px 0 18px; color: var(--app-text-muted); line-height: 1.6; }
.search-row { display: flex; gap: 8px; }
.result-list { display: grid; gap: 8px; min-height: 150px; margin-top: 16px; }
.result-item { display: grid; grid-template-columns: 1fr 70px 54px; align-items: center; gap: 10px; width: 100%; min-height: 50px; margin: 0; border: 1px solid var(--app-border); border-radius: 10px; padding: 9px 12px; background: var(--app-surface-raised); color: var(--app-text-strong); text-align: left; transition: border-color .18s ease, background .18s ease, transform .18s ease; }
.result-item:hover:not(:disabled) { border-color: var(--app-border-strong); background: var(--app-hover); transform: translateX(2px); }
.result-item:disabled { opacity: .48; cursor: default; }
.result-item span { display: flex; align-items: center; gap: 8px; }
code { border: 1px solid var(--app-border); border-radius: 5px; padding: 2px 6px; background: var(--app-accent-bg); color: var(--app-accent-soft); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.result-item small { color: var(--app-text-muted); }.result-item b { color: var(--app-accent-soft); font-size: 12px; text-align: right; }
.selected-list { display: grid; gap: 8px; min-height: 100px; }
.selected-item { display: grid; grid-template-columns: 150px 1fr 32px; align-items: center; gap: 8px; border: 1px solid var(--app-border); border-radius: 10px; padding: 8px 9px; background: var(--app-surface-raised); }
.selected-item > div { display: flex; min-width: 0; align-items: center; gap: 6px; }
.selected-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer-actions { position: sticky; z-index: 2; bottom: 0; display: flex; justify-content: flex-end; gap: 10px; margin: 24px -20px -20px; border-top: 1px solid var(--app-border); padding: 14px 20px; background: color-mix(in srgb, var(--app-surface) 94%, transparent); box-shadow: 0 -10px 28px var(--app-shadow); backdrop-filter: blur(14px); }
.drawer-actions :deep(.arco-btn-secondary) { border-color: var(--app-border); background: var(--app-surface-raised); color: var(--app-text-secondary); }
:deep(.arco-divider-text) { color: var(--app-text-muted); font-size: 11px; }
:deep(.arco-divider-horizontal) { border-color: var(--app-border); }
</style>
