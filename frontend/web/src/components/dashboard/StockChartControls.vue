<script setup>
defineProps({ setting: { type: Object, required: true }, loading: { type: Boolean, default: false } });
defineEmits(["change"]);
const ranges = [["day", "日"], ["week", "周"], ["month", "月"], ["halfYear", "半年"], ["year", "一年"]];
const intervals = [["1m", "1 分钟"], ["15m", "15 分钟"], ["30m", "30 分钟"], ["1h", "1 小时"], ["4h", "4 小时"], ["1d", "日 K"], ["1w", "周 K"]];
</script>

<template>
  <div class="chart-controls" @mousedown.stop>
    <a-radio-group :model-value="setting.range" type="button" size="mini" @change="$emit('change', 'range', $event)">
      <a-radio v-for="range in ranges" :key="range[0]" :value="range[0]">{{ range[1] }}</a-radio>
    </a-radio-group>
    <a-select :model-value="setting.interval" size="mini" :loading="loading" @change="$emit('change', 'interval', $event)">
      <a-option v-for="interval in intervals" :key="interval[0]" :value="interval[0]">{{ interval[1] }}</a-option>
    </a-select>
  </div>
</template>

<style scoped>
.chart-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 0 8px; cursor: default; }
.chart-controls :deep(.arco-select-view) { width: 104px; }
.chart-controls :deep(.arco-radio-button-content) { padding-inline: 7px; }
@media (max-width: 520px) { .chart-controls { align-items: stretch; flex-direction: column; } }
</style>
