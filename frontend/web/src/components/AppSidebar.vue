<script setup>
import {
  IconDashboard,
  IconExperiment,
  IconFile,
  IconMessage,
  IconMenuFold,
  IconMenuUnfold,
  IconSettings,
  IconRobot,
  IconTags,
} from "@arco-design/web-vue/es/icon";
import { computed } from "vue";
import { primaryNavigation, secondaryNavigation } from "../navigation.js";

const props = defineProps({
  activePrimary: { type: String, required: true },
  activeModule: { type: String, required: true },
  collapsed: { type: Boolean, default: false },
});

const emit = defineEmits(["navigate", "toggle"]);
const menuItems = computed(() => secondaryNavigation[props.activePrimary] ?? []);
const sectionTitle = computed(() => primaryNavigation.find((item) => item.key === props.activePrimary)?.label ?? "导航");
const icons = {
  dashboard: IconDashboard,
  experiment: IconExperiment,
  file: IconFile,
  message: IconMessage,
  robot: IconRobot,
  settings: IconSettings,
  tags: IconTags,
};
</script>

<template>
  <aside class="app-sidebar" :class="{ collapsed }">
    <div class="sidebar-title">
      <span v-if="!collapsed">{{ sectionTitle }}</span>
      <a-button type="text" shape="circle" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" @click="emit('toggle')">
        <IconMenuUnfold v-if="collapsed" />
        <IconMenuFold v-else />
      </a-button>
    </div>

    <a-menu
      :selected-keys="[activeModule]"
      :collapsed="collapsed"
      :auto-open-selected="true"
      @menu-item-click="emit('navigate', $event)"
    >
      <template v-for="item in menuItems" :key="item.key">
        <a-sub-menu v-if="item.children" :key="item.key">
          <template #icon><component :is="icons[item.icon]" /></template>
          <template #title>{{ item.label }}</template>
          <a-menu-item v-for="child in item.children" :key="child.key">{{ child.label }}</a-menu-item>
        </a-sub-menu>
        <a-menu-item v-else :key="item.key">
          <template #icon><component :is="icons[item.icon]" /></template>
          {{ item.label }}
        </a-menu-item>
      </template>
    </a-menu>
  </aside>
</template>

<style scoped>
.app-sidebar { position: relative; width: 240px; flex: 0 0 240px; height: 100%; overflow: auto; border-right: 1px solid var(--app-border); padding: 12px 8px; background: var(--app-sidebar); transition: width .2s ease, flex-basis .2s ease, background .25s ease; }
.app-sidebar.collapsed { width: 64px; flex-basis: 64px; }
.sidebar-title { display: flex; min-height: 42px; align-items: center; justify-content: space-between; padding: 0 8px 8px 14px; color: var(--app-text-muted); font-size: 12px; font-weight: 600; letter-spacing: .08em; }
.collapsed .sidebar-title { justify-content: center; padding-inline: 0; }
.app-sidebar :deep(.arco-menu) { width: 100%; border-radius: 8px; }
.app-sidebar :deep(.arco-menu-item), .app-sidebar :deep(.arco-menu-inline-header) { border-radius: 8px; }

@media (max-width: 700px) {
  .app-sidebar { position: absolute; z-index: 15; box-shadow: 8px 0 24px rgba(15, 23, 42, .12); }
  .app-sidebar.collapsed { width: 56px; flex-basis: 56px; box-shadow: none; }
}
</style>
