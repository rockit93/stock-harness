<script setup>
import { IconPlayArrow, IconQuestionCircle } from "@arco-design/web-vue/es/icon";

defineProps({
  modelValue: { type: Object, required: true },
  strategies: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  strategyLabel: { type: Function, required: true },
  paramLabel: { type: Function, required: true },
});

const emit = defineEmits(["submit", "market-change", "strategy-change", "range"]);
const ranges = [
  ["6m", "近 6 月"], [1, "近 1 年"], [3, "近 3 年"], [5, "近 5 年"], ["ytd", "今年以来"],
];

const tips = {
  adjust: "修正分红、送股造成的价格跳变；前复权适合观察当前价格下的历史走势。",
  strategy: "决定买卖时机的规则，例如双均线交叉。",
  cash: "回测开始时可用的模拟资金。",
  commission: "每次买入或卖出单独收取的成本，1 bps = 0.01%。",
};
</script>

<template>
  <a-card class="parameter-card" :bordered="false">
    <template #title>
      <div class="card-title"><span>回测参数</span><small>配置标的与策略规则</small></div>
    </template>
    <a-form :model="modelValue" layout="vertical" size="large" @submit-success="emit('submit')">
      <div class="form-grid two-columns">
        <a-form-item field="market" label="市场">
          <a-select v-model="modelValue.market" @change="emit('market-change')">
            <a-option value="A Share">A 股</a-option><a-option value="Hong Kong">港股</a-option><a-option value="US">美股</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="symbol" label="股票代码">
          <a-input v-model.trim="modelValue.symbol" placeholder="例如 600519" allow-clear />
        </a-form-item>
      </div>

      <div class="form-grid two-columns">
        <a-form-item field="start" label="开始日期"><a-date-picker v-model="modelValue.start" value-format="YYYY-MM-DD" /></a-form-item>
        <a-form-item field="end" label="结束日期"><a-date-picker v-model="modelValue.end" value-format="YYYY-MM-DD" /></a-form-item>
      </div>

      <div class="preset-field">
        <span>快速选择</span>
        <div class="preset-tags">
          <a-tag v-for="range in ranges" :key="range[1]" color="arcoblue" bordered class="preset-tag" @click="emit('range', range[0])">{{ range[1] }}</a-tag>
        </div>
      </div>

      <a-divider />

      <a-form-item field="adjust">
        <template #label>复权方式 <a-tooltip :content="tips.adjust"><IconQuestionCircle class="help-icon" /></a-tooltip></template>
        <a-select v-model="modelValue.adjust">
          <a-option value="qfq">前复权</a-option><a-option value="hfq">后复权</a-option><a-option value="none">不复权</a-option>
        </a-select>
      </a-form-item>
      <a-form-item field="strategy">
        <template #label>策略 <a-tooltip :content="tips.strategy"><IconQuestionCircle class="help-icon" /></a-tooltip></template>
        <a-select v-model="modelValue.strategy" @change="emit('strategy-change')">
          <a-option v-for="strategy in strategies" :key="strategy.key" :value="strategy.key">{{ strategyLabel(strategy.key, strategy.label) }}</a-option>
        </a-select>
      </a-form-item>

      <div class="form-grid two-columns">
        <a-form-item v-for="(_, key) in modelValue.strategy_params" :key="key" :field="`strategy_params.${key}`" :label="paramLabel(key)">
          <a-input-number v-model="modelValue.strategy_params[key]" :min="1" hide-button />
        </a-form-item>
      </div>

      <div class="form-grid two-columns">
        <a-form-item field="cash">
          <template #label>初始资金 <a-tooltip :content="tips.cash"><IconQuestionCircle class="help-icon" /></a-tooltip></template>
          <a-input-number v-model="modelValue.cash" :min="0" hide-button><template #prefix>¥</template></a-input-number>
        </a-form-item>
        <a-form-item field="commission_bps">
          <template #label>单边手续费 <a-tooltip :content="tips.commission"><IconQuestionCircle class="help-icon" /></a-tooltip></template>
          <a-input-number v-model="modelValue.commission_bps" :min="0" hide-button><template #suffix>bps</template></a-input-number>
        </a-form-item>
      </div>

      <a-button html-type="submit" type="primary" long size="large" :loading="loading">
        <template #icon><IconPlayArrow /></template>{{ loading ? "正在回测" : "运行回测" }}
      </a-button>
    </a-form>
  </a-card>
</template>

<style scoped>
.parameter-card { border: 1px solid #e5e8ef; border-radius: 14px; box-shadow: 0 8px 28px rgba(29, 33, 41, .05); }
.card-title { display: grid; gap: 3px; }
.card-title span { color: #1d2129; font-size: 16px; font-weight: 650; }
.card-title small { color: #86909c; font-size: 12px; font-weight: 400; }
.form-grid { display: grid; gap: 12px; }
.two-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.preset-field { margin: -2px 0 4px; }
.preset-field > span { display: block; margin-bottom: 8px; color: #86909c; font-size: 12px; }
.preset-tags { display: flex; flex-wrap: wrap; gap: 7px; }
.preset-tag { cursor: pointer; border-radius: 999px; padding-inline: 10px; transition: transform .15s ease, box-shadow .15s ease; }
.preset-tag:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(22, 93, 255, .14); }
.help-icon { margin-left: 4px; color: #a9b0bd; cursor: help; }
:deep(.arco-form-item) { margin-bottom: 16px; }
:deep(.arco-form-item-label-col) { padding-bottom: 6px; }
:deep(.arco-picker), :deep(.arco-input-number) { width: 100%; }
:deep(.arco-divider-horizontal) { margin: 14px 0 18px; }

@media (max-width: 520px) { .two-columns { grid-template-columns: 1fr; } }
</style>
