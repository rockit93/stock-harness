<script setup>
import { IconApps, IconList } from "@arco-design/web-vue/es/icon";

defineProps({
  viewMode: { type: String, default: "cards" },
  columns: { type: Number, default: 4 },
});
defineEmits(["update:viewMode", "update:columns"]);
</script>

<template>
  <div class="view-controls">
    <a-radio-group :model-value="viewMode" type="button" size="small" @change="$emit('update:viewMode', $event)">
      <a-radio value="cards"><IconApps /> 卡片</a-radio>
      <a-radio value="table"><IconList /> 表格</a-radio>
    </a-radio-group>
    <a-radio-group v-if="viewMode === 'cards'" :model-value="columns" type="button" size="small" @change="$emit('update:columns', Number($event))">
      <a-radio :value="2">2 列</a-radio><a-radio :value="3">3 列</a-radio><a-radio :value="4">4 列</a-radio>
    </a-radio-group>
  </div>
</template>

<style scoped>
.view-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; }
.view-controls :deep(.arco-radio-button-content) { display: inline-flex; align-items: center; gap: 5px; }
</style>
