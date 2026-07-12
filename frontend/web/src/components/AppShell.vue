<script setup>
import { ref } from "vue";
import AppHeader from "./AppHeader.vue";
import AppSidebar from "./AppSidebar.vue";

defineProps({
  activePrimary: { type: String, required: true },
  activeModule: { type: String, required: true },
  username: { type: String, default: "" },
  theme: { type: String, default: "midnight" },
});

defineEmits(["primary-navigate", "module-navigate", "logout", "theme-change"]);
const sidebarCollapsed = ref(false);
</script>

<template>
  <div class="app-shell">
    <AppHeader
      :active-primary="activePrimary"
      :username="username"
      :theme="theme"
      @navigate="$emit('primary-navigate', $event)"
      @theme-change="$emit('theme-change', $event)"
      @logout="$emit('logout')"
    />
    <div class="app-body">
      <AppSidebar
        :active-primary="activePrimary"
        :active-module="activeModule"
        :collapsed="sidebarCollapsed"
        @navigate="$emit('module-navigate', $event)"
        @toggle="sidebarCollapsed = !sidebarCollapsed"
      />
      <div class="app-content"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.app-shell { display: grid; grid-template-rows: 60px minmax(0, 1fr); height: 100vh; height: 100dvh; overflow: hidden; background: var(--app-bg); color: var(--app-text); transition: background .25s ease, color .25s ease; }
.app-body { position: relative; display: flex; min-width: 0; min-height: 0; overflow: hidden; }
.app-content { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
</style>
