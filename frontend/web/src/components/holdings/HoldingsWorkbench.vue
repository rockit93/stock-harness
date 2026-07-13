<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
const props = defineProps({ request: { type: Function, required: true }, models: { type: Array, default: () => [] }, privateModels: { type: Array, default: () => [] } });
const tab = ref("personal"), rows = ref([]), quotes = ref({}), loading = ref(false), quoteLoading = ref(false), editorOpen = ref(false), importOpen = ref(false), parsing = ref(false), saving = ref(false), preview = ref([]), warnings = ref([]), fileName = ref(""), parseError = ref("");
let quoteTimer = null;
const form = reactive({ market: "A Share", symbol: "", stockName: "", shares: 0, costAmount: 0, strategyName: "" }); const modelId = ref(null);
const totals = computed(() => rows.value.reduce((result, row) => {
  const marketValue = valueOf(row);
  result.count += 1;
  result.cost += Number(row.costAmount || 0);
  if (marketValue !== null) { result.value += marketValue; result.quotedCost += Number(row.costAmount || 0); result.quotedCount += 1; }
  return result;
}, { count: 0, cost: 0, value: 0, quotedCost: 0, quotedCount: 0 }));
const totalProfit = computed(() => totals.value.value - totals.value.quotedCost);
const visionModels = computed(() => [
  ...props.privateModels.filter((item) => item.enabled && item.supportsVision).map((item) => ({ key: `private::${item.model}`, label: `${item.model} · Ollama 本地视觉`, privateModel: item.model })),
  ...props.models.filter((item) => /(vl|vision|visual|gpt-4o|gpt-4\.1|gpt-5|gemini|claude-3|claude-4|qvq|llava|minicpm-v|gemma-?3)/i.test(`${item.name} ${item.model}`)).map((item) => ({ key: `config::${item.id}`, label: `${item.name} · ${item.model}`, modelConfigId: item.id })),
]);
const money = (v) => Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quoteOf = (row) => quotes.value[row.id];
const valueOf = (row) => Number.isFinite(quoteOf(row)?.price) ? quoteOf(row).price * Number(row.shares || 0) : null;
const profitOf = (row) => valueOf(row) === null ? null : valueOf(row) - Number(row.costAmount || 0);
const profitRateOf = (row) => Number(row.costAmount) > 0 && profitOf(row) !== null ? profitOf(row) / Number(row.costAmount) * 100 : null;
const profitClass = (value) => Number(value) > 0 ? "is-profit" : Number(value) < 0 ? "is-loss" : "";
const percent = (value) => value === null ? "—" : `${value > 0 ? "+" : ""}${Number(value).toFixed(2)}%`;
const dateFromNow = (days = 2) => { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10); };
const quoteTime = (value) => { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); };
async function refreshQuotes() {
  if (quoteLoading.value || !rows.value.length) return;
  quoteLoading.value = true;
  const updates = {};
  await Promise.all(rows.value.map(async (row) => {
    try {
      const payload = await props.request("/bars", { method: "POST", body: JSON.stringify({ market: row.market, symbol: row.symbol, start: dateFromNow(), end: dateFromNow(0), adjust: "qfq", interval: "1m", range: "day" }) });
      const bar = (payload.bars || []).at(-1);
      if (!bar || !Number.isFinite(Number(bar.close))) throw new Error("暂无可用行情");
      updates[row.id] = { price: Number(bar.close), time: bar.date || new Date().toISOString(), error: "" };
    } catch (error) {
      updates[row.id] = { ...(quotes.value[row.id] || {}), error: error instanceof Error ? error.message : "行情读取失败" };
    }
  }));
  quotes.value = { ...quotes.value, ...updates };
  quoteLoading.value = false;
}
async function load() { loading.value = true; try { rows.value = await props.request(`/holdings?type=${tab.value}`); await refreshQuotes(); } finally { loading.value = false; } }
function openEditor(row) { Object.assign(form, row ? { ...row } : { market: "A Share", symbol: "", stockName: "", shares: 0, costAmount: 0, strategyName: "" }); editorOpen.value = true; }
async function save() { saving.value = true; try { await props.request("/holdings", { method: "POST", body: JSON.stringify({ ...form, type: tab.value, source: tab.value === "paper" && form.strategyName ? "backtest" : "manual" }) }); editorOpen.value = false; await load(); } finally { saving.value = false; } }
async function remove(row) { await props.request(`/holdings/${row.id}`, { method: "DELETE" }); await load(); }
async function chooseImage(event) { const file = event.target.files?.[0]; if (!file) return; fileName.value = file.name; preview.value = []; warnings.value = []; parseError.value = ""; parsing.value = true; try { const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); const selectedModel = visionModels.value.find((item) => item.key === modelId.value); const result = await props.request("/holdings/vision-parse", { method: "POST", body: JSON.stringify({ image, modelConfigId: selectedModel?.modelConfigId, privateModel: selectedModel?.privateModel }) }); preview.value = result.holdings.map((x) => ({ market: x.market || "A Share", symbol: String(x.symbol || "").toUpperCase(), stockName: x.stockName || "", shares: Number(x.shares || 0), costAmount: Number(x.costAmount || 0) })); warnings.value = result.warnings || []; } catch (error) { parseError.value = error instanceof Error ? error.message : String(error); } finally { parsing.value = false; event.target.value = ""; } }
async function confirmImport() { saving.value = true; try { await props.request("/holdings/import", { method: "POST", body: JSON.stringify({ holdings: preview.value }) }); importOpen.value = false; await load(); } finally { saving.value = false; } }
async function switchTab(value) { tab.value = value; quotes.value = {}; await load(); }
onMounted(async () => { await load(); quoteTimer = window.setInterval(refreshQuotes, 60_000); });
onBeforeUnmount(() => { if (quoteTimer) window.clearInterval(quoteTimer); });
</script>
<template><div class="holdings-workbench">
  <header class="holdings-head"><div><h2>持仓管理</h2><p>记录真实持仓，或用回测策略建立独立的模拟组合。</p></div><a-space><a-button v-if="tab === 'personal'" @click="importOpen = true">智能导入</a-button><a-button type="primary" @click="openEditor()">{{ tab === 'personal' ? '添加持仓' : '添加模拟持仓' }}</a-button></a-space></header>
  <a-tabs :active-key="tab" @change="switchTab"><a-tab-pane key="personal" title="个人持仓"/><a-tab-pane key="paper" title="模拟持仓"/></a-tabs>
  <div class="holding-summary"><article><span>持仓标的</span><strong>{{ totals.count }}</strong></article><article><span>总成本金额</span><strong>¥ {{ money(totals.cost) }}</strong></article><article><span>持仓市值</span><strong>{{ totals.quotedCount ? `¥ ${money(totals.value)}` : '—' }}</strong></article><article><span>浮动盈亏</span><strong :class="profitClass(totalProfit)">{{ totals.quotedCount ? `${totalProfit > 0 ? '+' : ''}¥ ${money(totalProfit)}` : '—' }}</strong></article></div>
  <div class="holding-table-head"><span>持仓明细</span><small><i :class="{ refreshing: quoteLoading }"></i>{{ quoteLoading ? '正在读取行情' : '现价每分钟自动更新' }}</small></div>
  <a-table class="holding-table" :data="rows" :loading="loading" row-key="id" :pagination="false" :scroll="{ x: 1450 }" :bordered="{ cell: true }">
    <a-table-column title="股票" :width="190" fixed="left"><template #cell="{ record }"><div class="holding-stock"><strong>{{ record.stockName || record.symbol }}</strong><small>{{ record.symbol }} · {{ record.market }}</small></div></template></a-table-column>
    <a-table-column title="股数" data-index="shares" :width="110"/>
    <a-table-column title="平均成本" :width="130" align="right"><template #cell="{ record }">¥ {{ money(record.averageCost) }}</template></a-table-column>
    <a-table-column title="总成本" :width="145" align="right"><template #cell="{ record }">¥ {{ money(record.costAmount) }}</template></a-table-column>
    <a-table-column title="现价" :width="130" align="right"><template #cell="{ record }"><a-tooltip v-if="quoteOf(record)?.error" :content="quoteOf(record).error"><strong v-if="Number.isFinite(quoteOf(record)?.price)">¥ {{ money(quoteOf(record).price) }}</strong><span v-else class="quote-error">—</span></a-tooltip><strong v-else-if="quoteOf(record)">¥ {{ money(quoteOf(record).price) }}</strong><span v-else>—</span></template></a-table-column>
    <a-table-column title="持仓市值" :width="150" align="right"><template #cell="{ record }">{{ valueOf(record) === null ? '—' : `¥ ${money(valueOf(record))}` }}</template></a-table-column>
    <a-table-column title="浮动盈亏" :width="155" align="right"><template #cell="{ record }"><strong v-if="profitOf(record) !== null" :class="profitClass(profitOf(record))">{{ profitOf(record) > 0 ? '+' : '' }}¥ {{ money(profitOf(record)) }}</strong><span v-else>—</span></template></a-table-column>
    <a-table-column title="盈亏率" :width="120" align="right"><template #cell="{ record }"><strong :class="profitClass(profitRateOf(record))">{{ percent(profitRateOf(record)) }}</strong></template></a-table-column>
    <a-table-column title="行情时间" :width="145"><template #cell="{ record }"><span class="quote-time">{{ quoteTime(quoteOf(record)?.time) }}</span></template></a-table-column>
    <a-table-column v-if="tab === 'paper'" title="回测策略" :width="180"><template #cell="{ record }">{{ record.strategyName || '手动模拟' }}</template></a-table-column>
    <a-table-column title="录入方式" :width="115"><template #cell="{ record }"><a-tag>{{ record.source === 'vision' ? '智能导入' : record.source === 'backtest' ? '回测策略' : '手动' }}</a-tag></template></a-table-column>
    <a-table-column title="操作" :width="140" fixed="right"><template #cell="{ record }"><a-space><a-button type="text" size="small" @click="openEditor(record)">编辑</a-button><a-popconfirm content="确定删除这条持仓吗？" @ok="remove(record)"><a-button type="text" status="danger" size="small">删除</a-button></a-popconfirm></a-space></template></a-table-column>
    <template #empty><a-empty :description="tab === 'personal' ? '暂无个人持仓，可手动添加或从截图智能导入。' : '暂无模拟持仓，可录入回测策略的模拟买入。'"/></template>
  </a-table>
  <a-modal v-model:visible="editorOpen" :title="tab === 'personal' ? '个人持仓' : '模拟持仓'" :ok-loading="saving" @ok="save"><a-form :model="form" layout="vertical"><div class="holding-form-grid"><a-form-item label="市场"><a-select v-model="form.market"><a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option></a-select></a-form-item><a-form-item label="股票代码" required><a-input v-model="form.symbol"/></a-form-item><a-form-item label="股票名称"><a-input v-model="form.stockName"/></a-form-item><a-form-item label="股数" required><a-input-number v-model="form.shares" :min="0"/></a-form-item><a-form-item label="成本金额" required><a-input-number v-model="form.costAmount" :min="0"/></a-form-item><a-form-item v-if="tab === 'paper'" label="回测策略来源"><a-input v-model="form.strategyName" placeholder="如：双均线趋势策略"/></a-form-item></div></a-form></a-modal>
  <a-modal v-model:visible="importOpen" title="截图智能导入" width="780px" :footer="false"><p class="import-tip">截图仅发送给选择的视觉模型进行本次识别，不会创建 AI 助手会话。识别后请确认股数与总成本。</p><a-select v-model="modelId" placeholder="请选择视觉模型" style="width:100%;margin-bottom:12px"><a-option v-for="model in visionModels" :key="model.key" :value="model.key">{{ model.label }}</a-option></a-select><a-alert v-if="!visionModels.length" type="warning" title="暂无可用视觉模型，请先在模型管理中添加 VL / Vision 模型。"/><label class="holding-uploader"><input type="file" accept="image/png,image/jpeg,image/webp" :disabled="!modelId" @change="chooseImage"><strong>{{ parsing ? '正在识别…' : '选择证券账户持仓截图' }}</strong><span>{{ fileName || '支持 PNG、JPG、WebP，建议隐去账号等敏感信息' }}</span></label><a-alert v-if="parseError" type="error" :title="parseError"/><a-alert v-if="warnings.length" type="warning" :title="warnings.join('；')"/><a-table v-if="preview.length" :data="preview" :pagination="false" size="small"><a-table-column title="代码"><template #cell="{ record }"><a-input v-model="record.symbol"/></template></a-table-column><a-table-column title="名称"><template #cell="{ record }"><a-input v-model="record.stockName"/></template></a-table-column><a-table-column title="股数"><template #cell="{ record }"><a-input-number v-model="record.shares" :min="0"/></template></a-table-column><a-table-column title="总成本"><template #cell="{ record }"><a-input-number v-model="record.costAmount" :min="0"/></template></a-table-column></a-table><footer class="import-actions"><a-button @click="importOpen = false">取消</a-button><a-button type="primary" :disabled="!preview.length" :loading="saving" @click="confirmImport">确认并更新持仓</a-button></footer></a-modal>
</div></template>
<style scoped>.holdings-workbench{display:grid;gap:16px}.holdings-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.holdings-head h2{margin:0;color:var(--app-text-strong)}.holdings-head p{margin:5px 0 0;color:var(--app-text-muted)}.holding-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.holding-summary article{display:grid;gap:8px;border:1px solid var(--app-border);border-radius:12px;padding:16px;background:var(--app-surface-raised)}.holding-summary span,.holding-stock small,.import-tip,.quote-time{color:var(--app-text-muted)}.holding-summary strong{color:var(--app-text-strong);font-size:20px}.holding-table-head{display:flex;align-items:center;justify-content:space-between;color:var(--app-text-strong)}.holding-table-head small{display:flex;align-items:center;gap:7px;color:var(--app-text-muted)}.holding-table-head i{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px var(--app-success-bg)}.holding-table-head i.refreshing{animation:quote-pulse 1s ease-in-out infinite}.holding-table :deep(.arco-table-container){border-color:var(--app-border)}.holding-stock{display:grid;gap:3px}.is-profit{color:#22c55e!important}.is-loss,.quote-error{color:#ef4444!important}.holding-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.holding-uploader{display:grid;place-items:center;gap:6px;border:1px dashed var(--app-border-strong);border-radius:12px;padding:30px;background:var(--app-surface-muted);color:var(--app-text-muted);cursor:pointer}.holding-uploader:hover{border-color:var(--app-accent);background:var(--app-accent-bg)}.holding-uploader input{position:absolute;width:1px;height:1px;opacity:0}.holding-uploader strong{color:var(--app-text-strong)}.import-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}@keyframes quote-pulse{50%{opacity:.35;transform:scale(.75)}}@media(max-width:980px){.holding-summary{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.holdings-head{align-items:flex-start;flex-direction:column}.holding-summary,.holding-form-grid{grid-template-columns:1fr}.holding-table-head{align-items:flex-start;flex-direction:column;gap:5px}}</style>
