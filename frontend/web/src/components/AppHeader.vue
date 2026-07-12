<script setup>
import {
  IconCheck,
  IconDashboard,
  IconExperiment,
  IconExport,
  IconPalette,
  IconRobot,
  IconSettings,
  IconUser,
} from "@arco-design/web-vue/es/icon";
import { primaryNavigation } from "../navigation.js";

defineProps({
  activePrimary: { type: String, required: true },
  username: { type: String, default: "" },
  theme: { type: String, default: "midnight" },
});

const emit = defineEmits(["navigate", "logout", "theme-change"]);
const icons = { dashboard: IconDashboard, experiment: IconExperiment, robot: IconRobot, settings: IconSettings };
const themes = [
  { key: "midnight", name: "深海量化", note: "默认深色", colors: ["#07110f", "#55d9a5"] },
  { key: "obsidian", name: "曜石终端", note: "蓝黑高对比", colors: ["#0b1020", "#6d8cff"] },
  { key: "daylight", name: "晨雾研究", note: "明亮舒适", colors: ["#f4f7f6", "#168565"] },
];
</script>

<template>
  <header class="app-header">
    <div class="brand" aria-label="AlphaDock 首页">
      <div class="brand-mark">A<span>↗</span></div>
      <div class="brand-copy"><strong>AlphaDock</strong><span>阿尔法舱 · 量化智能工作台</span></div>
    </div>

    <a-menu class="primary-menu" mode="horizontal" :selected-keys="[activePrimary]" @menu-item-click="emit('navigate', $event)">
      <a-menu-item v-for="item in primaryNavigation" :key="item.key">
        <template #icon><component :is="icons[item.icon]" /></template>{{ item.label }}
      </a-menu-item>
    </a-menu>

    <div class="header-actions">
      <a-dropdown trigger="click" position="br">
        <button class="theme-trigger" type="button" aria-label="切换界面主题"><IconPalette /><span>主题</span></button>
        <template #content>
          <div class="theme-menu-head"><strong>界面主题</strong><span>选择你的研究环境</span></div>
          <a-doption v-for="item in themes" :key="item.key" @click="emit('theme-change', item.key)">
            <div class="theme-option">
              <span class="theme-swatch" :style="{ background: item.colors[0] }"><i :style="{ background: item.colors[1] }"></i></span>
              <span><strong>{{ item.name }}</strong><small>{{ item.note }}</small></span>
              <IconCheck v-if="theme === item.key" class="theme-check" />
            </div>
          </a-doption>
        </template>
      </a-dropdown>

      <a-dropdown trigger="click" position="br">
        <button class="user-trigger" type="button" aria-label="打开用户菜单"><a-avatar :size="30"><IconUser /></a-avatar><span>{{ username }}</span></button>
        <template #content><a-doption @click="emit('logout')"><IconExport /> 退出登录</a-doption></template>
      </a-dropdown>
    </div>
  </header>
</template>

<style scoped>
.app-header { position: relative; z-index: 20; display: flex; align-items: center; height: 60px; padding: 0 20px; border-bottom: 1px solid var(--app-border); background: var(--app-header); box-shadow: 0 1px 12px var(--app-shadow); backdrop-filter: blur(18px); }
.brand { display: flex; align-items: center; gap: 10px; width: 236px; flex: 0 0 236px; }
.brand-mark { display: flex; width: 34px; height: 34px; place-content: center; align-items: center; border-radius: 10px; background: var(--app-brand-gradient); color: var(--app-accent-soft); font-size: 14px; font-weight: 800; }
.brand-mark span { margin: -8px 0 0 1px; font-size: 10px; }
:global(html[data-theme="daylight"]) .brand-mark { border: 1px solid #c6ddd5; background: #fff; color: #168565; box-shadow: 0 3px 10px rgba(22, 133, 101, .09); }
:global(html[data-theme="daylight"]) .brand-mark span { color: #22a47c; }
.brand-copy { display: grid; gap: 1px; }.brand-copy strong { color: var(--app-text-strong); font-size: 15px; }.brand-copy span { color: var(--app-text-muted); font-size: 10px; }
.primary-menu { flex: 1; height: 59px; border-bottom: 0; background: transparent; }
.header-actions { display: flex; align-items: center; gap: 4px; }
.theme-trigger, .user-trigger { display: flex; width: auto !important; min-height: 38px !important; align-items: center; gap: 7px; margin: 0 !important; border: 0 !important; border-radius: 9px !important; padding: 4px 9px !important; background: transparent !important; color: var(--app-text-secondary) !important; font-size: 12px; font-weight: 500 !important; }
.theme-trigger:hover, .user-trigger:hover { background: var(--app-hover) !important; }
.theme-menu-head { display: grid; gap: 3px; min-width: 226px; padding: 10px 12px 8px; }.theme-menu-head strong { color: var(--app-text-strong); font-size: 13px; }.theme-menu-head span { color: var(--app-text-muted); font-size: 10px; }
.theme-option { display: grid; grid-template-columns: 32px minmax(0, 1fr) 16px; align-items: center; gap: 10px; min-width: 218px; padding: 3px 0; }
.theme-option > span:nth-child(2) { display: grid; gap: 1px; }.theme-option strong { color: var(--app-text-strong); font-size: 12px; }.theme-option small { color: var(--app-text-muted); font-size: 10px; }
.theme-swatch { position: relative; display: block; width: 30px; height: 24px; overflow: hidden; border: 1px solid var(--app-border); border-radius: 7px; }.theme-swatch i { position: absolute; right: 4px; bottom: 4px; width: 9px; height: 9px; border-radius: 50%; }.theme-check { color: var(--app-accent); }
@media (max-width: 820px) { .brand { width: 52px; flex-basis: 52px; }.brand-copy, .user-trigger span, .theme-trigger span { display: none; }.app-header { padding: 0 10px; } }
</style>
