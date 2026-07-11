import { createRouter, createWebHistory } from "vue-router";

// Routes provide stable URLs while metadata selects a view in the existing shell.
export const moduleRoutes = {
  dashboard: { name: "dashboard", path: "/dashboard" },
  "label-strategies": { name: "label-strategies", path: "/strategies/labels" },
  backtest: { name: "backtest", path: "/strategies/backtest" },
  "pi-chat": { name: "pi-chat", path: "/pi/chat" },
  "pi-tasks": { name: "pi-tasks", path: "/pi/tasks" },
  "pi-roles": { name: "pi-roles", path: "/pi/roles" },
  "pi-skills": { name: "pi-skills", path: "/pi/skills" },
  "pi-plugins": { name: "pi-plugins", path: "/pi/plugins" },
  settings: { name: "settings", path: "/settings" },
};

const routes = Object.entries(moduleRoutes).map(([module, route]) => ({
  ...route,
  component: { template: "<span />" },
  meta: { module },
}));

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", redirect: moduleRoutes.dashboard.path },
    ...routes,
    { path: "/:pathMatch(.*)*", redirect: moduleRoutes.dashboard.path },
  ],
});
