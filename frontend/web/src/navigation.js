export const primaryNavigation = [
  { key: "workspace", label: "工作台", icon: "dashboard", defaultModule: "dashboard" },
  { key: "strategy", label: "策略研究", icon: "experiment", defaultModule: "label-strategies" },
  { key: "assistant", label: "AI 助手", icon: "robot", defaultModule: "pi-chat" },
  { key: "system", label: "系统管理", icon: "settings", defaultModule: "data-sources" },
];

export const secondaryNavigation = {
  workspace: [
    { key: "dashboard", label: "市场概览", icon: "dashboard" },
  ],
  strategy: [
    { key: "label-strategies", label: "标签策略", icon: "tags" },
    { key: "backtest-strategies", label: "回测策略", icon: "experiment" },
  ],
  assistant: [
    { key: "pi-chat", label: "新对话", icon: "message" },
    {
      key: "project-center",
      label: "项目管理",
      icon: "dashboard",
      children: [
        { key: "pi-projects", label: "项目列表" },
        { key: "pi-tasks", label: "任务中心" },
      ],
    },
    {
      key: "assistant-config",
      label: "助手配置",
      icon: "settings",
      children: [
        { key: "pi-roles", label: "角色管理" },
        { key: "pi-skills", label: "Skill 管理" },
        { key: "pi-plugins", label: "插件管理" },
      ],
    },
  ],
  system: [
    {
      key: "personal-settings",
      label: "个人设置",
      icon: "settings",
      children: [
        { key: "display-settings", label: "显示偏好" },
      ],
    },
    { key: "data-sources", label: "数据源管理", icon: "dashboard" },
    { key: "models", label: "模型管理", icon: "robot" },
  ],
};

export function findPrimaryKey(moduleKey) {
  return primaryNavigation.find(({ key }) =>
    secondaryNavigation[key]?.some((item) =>
      item.key === moduleKey || item.children?.some((child) => child.key === moduleKey),
    ),
  )?.key ?? "workspace";
}
