import type { View } from "../types";

// Personal module inventory. Platform support and account authorization are separate.
export type ModuleId =
  | "overview" | "goals" | "tasks" | "calendar" | "countdowns"
  | "people" | "infrastructure" | "work-monitor" | "bead-studio"
  | "meal-planner" | "shopping-list" | "fitness" | "travel";
export type ModulePlatform = "browser" | "linux" | "windows" | "macos" | "android" | "ios";
export type NavigationGroup = "global" | "tasks" | "projects" | "life";

interface ModuleDefinition {
  title: string;
  platforms: readonly ModulePlatform[];
}
interface ViewDefinition {
  module: ModuleId;
  label: string;
  group: NavigationGroup;
}

const allPlatforms: readonly ModulePlatform[] = ["browser", "linux", "windows", "macos", "android", "ios"];
const desktopPlatforms: readonly ModulePlatform[] = ["browser", "linux", "windows", "macos"];

export const moduleCatalog: Readonly<Record<ModuleId, ModuleDefinition>> = {
  overview: { title: "今日总览", platforms: allPlatforms },
  goals: { title: "想法与目标", platforms: allPlatforms },
  tasks: { title: "任务与记事本", platforms: allPlatforms },
  calendar: { title: "计划日历", platforms: allPlatforms },
  countdowns: { title: "关键日期", platforms: allPlatforms },
  people: { title: "人物档案", platforms: allPlatforms },
  infrastructure: { title: "主机与服务", platforms: allPlatforms },
  "work-monitor": { title: "工作观察", platforms: desktopPlatforms },
  // Android exposes the continuation/progress view; full editing remains desktop.
  "bead-studio": { title: "拼豆图纸", platforms: [...desktopPlatforms, "android"] },
  "meal-planner": { title: "AI 食谱", platforms: allPlatforms },
  "shopping-list": { title: "采购清单", platforms: allPlatforms },
  fitness: { title: "训练计划", platforms: allPlatforms },
  travel: { title: "旅行规划", platforms: allPlatforms },
};

// Record<View, ...> makes an unregistered new route a type-checking error.
// A module may own several views; task filters are not separate products.
export const viewCatalog: Readonly<Record<View, ViewDefinition>> = {
  overview: { module: "overview", label: "总览", group: "global" },
  goals: { module: "goals", label: "想法与目标", group: "global" },
  calendar: { module: "calendar", label: "计划日历", group: "global" },
  countdowns: { module: "countdowns", label: "关键日期", group: "global" },
  people: { module: "people", label: "人物档案", group: "global" },
  today: { module: "tasks", label: "今天", group: "tasks" },
  all: { module: "tasks", label: "所有计划", group: "tasks" },
  completed: { module: "tasks", label: "完成记录", group: "tasks" },
  infrastructure: { module: "infrastructure", label: "主机与服务", group: "projects" },
  "work-monitor": { module: "work-monitor", label: "工作观察", group: "projects" },
  "bead-studio": { module: "bead-studio", label: "拼豆图纸", group: "projects" },
  "meal-planner": { module: "meal-planner", label: "AI 食谱", group: "life" },
  "shopping-list": { module: "shopping-list", label: "采购清单", group: "life" },
  fitness: { module: "fitness", label: "训练计划", group: "life" },
  travel: { module: "travel", label: "旅行规划", group: "life" },
};

export const navigationGroups: readonly { id: NavigationGroup; name: string }[] = [
  { id: "global", name: "全局导航" },
  { id: "tasks", name: "任务管理" },
  { id: "projects", name: "个人项目" },
  { id: "life", name: "生活与出行" },
];

export function moduleForView(view: View): ModuleId | undefined {
  // Runtime routes may come from older persisted state. Reject unknown values,
  // including inherited property names, rather than treating them as available.
  return Object.hasOwn(viewCatalog, view) ? viewCatalog[view].module : undefined;
}

export function viewSupportsPlatform(view: View, platform: ModulePlatform): boolean {
  const module = moduleForView(view);
  return module !== undefined && moduleCatalog[module].platforms.includes(platform);
}

export function registeredNavigation() {
  const views = Object.keys(viewCatalog) as View[];
  return navigationGroups.map(group => ({
    ...group,
    items: views.filter(view => viewCatalog[view].group === group.id)
      .map(view => ({ view, label: viewCatalog[view].label, module: viewCatalog[view].module })),
  }));
}
