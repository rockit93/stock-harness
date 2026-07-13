import { createRouter, createWebHistory } from "vue-router";

// Routes provide stable URLs while metadata selects a view in the existing shell.
export const moduleRoutes = {
  dashboard: { name: "dashboard", path: "/dashboard" },
  holdings: { name: "holdings", path: "/workspace/holdings" },
  "stock-detail": { name: "stock-detail", path: "/stock/:market/:symbol" },
  "label-strategies": { name: "label-strategies", path: "/strategies/labels" },
  "pi-chat": { name: "pi-chat", path: "/chat/:projectId/:conversationId" },
  "pi-projects": { name: "pi-projects", path: "/pi/projects" },
  "pi-tasks": { name: "pi-tasks", path: "/pi/tasks" },
  "pi-roles": { name: "pi-roles", path: "/pi/roles" },
  "pi-skills": { name: "pi-skills", path: "/pi/skills" },
  "pi-plugins": { name: "pi-plugins", path: "/pi/plugins" },
  "data-sources": { name: "data-sources", path: "/system/data-sources" },
  models: { name: "models", path: "/system/models" },
  "model-monitoring": { name: "model-monitoring", path: "/system/model-monitoring" },
  "display-settings": { name: "display-settings", path: "/system/display" },
  "im-connectors": { name: "im-connectors", path: "/system/im-connectors" },
  "backtest-strategies": { name: "backtest-strategies", path: "/strategies/backtest" },
  "backtest-datasets": { name: "backtest-datasets", path: "/strategies/backtest-datasets" },
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
    {
      path: "/pi/chat",
      redirect: (to) => ({
        name: "pi-chat",
        params: {
          projectId: to.query.project || "my",
          conversationId: to.query.conversation || "new",
        },
      }),
    },
    { path: "/settings", redirect: moduleRoutes["data-sources"].path },
    { path: "/system/backtest-strategies", redirect: moduleRoutes["backtest-strategies"].path },
    ...routes,
    { path: "/:pathMatch(.*)*", redirect: moduleRoutes.dashboard.path },
  ],
});
