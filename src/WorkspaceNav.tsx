import {
  Archive,
  CalendarRange,
  ChefHat,
  Gauge,
  Hourglass,
  LayoutList,
  Radar,
  ShoppingBasket,
  Sparkles,
  Grid2X2,
  Users,
  Dumbbell,
  MapPin,
  Compass,
} from "lucide-react";
import type { View } from "./types";

export default function WorkspaceNav({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  const groups: {
    name: string;
    items: { view: View; label: string; icon: typeof Gauge }[];
  }[] = [
    {
      name: "全局导航",
      items: [
        { view: "overview", label: "总览", icon: Gauge },
        { view: "goals", label: "想法与目标", icon: Compass },
        { view: "calendar", label: "计划日历", icon: CalendarRange },
        { view: "countdowns", label: "关键日期", icon: Hourglass },
        { view: "people", label: "人物档案", icon: Users },
      ],
    },
    {
      name: "任务管理",
      items: [
        { view: "today", label: "今天", icon: Sparkles },
        { view: "all", label: "所有计划", icon: LayoutList },
        { view: "completed", label: "完成记录", icon: Archive },
      ],
    },
    {
      name: "个人项目",
      items: [
        { view: "work-monitor", label: "工作观察", icon: Radar },
        { view: "bead-studio", label: "拼豆图纸", icon: Grid2X2 },
      ],
    },
    {
      name: "生活与出行",
      items: [
        { view: "meal-planner", label: "AI 食谱", icon: ChefHat },
        { view: "shopping-list", label: "采购清单", icon: ShoppingBasket },
        { view: "fitness", label: "训练计划", icon: Dumbbell },
        { view: "travel", label: "旅行规划", icon: MapPin },
      ],
    },
  ];
  return (
    <nav className="main-nav workspace-nav" aria-label="工作区导航">
      {groups.map((group) => (
        <section key={group.name} aria-label={group.name}>
          <h2>{group.name}</h2>
          {group.items.map((item) => (
            <button
              key={item.view}
              type="button"
              className={view === item.view ? "active" : ""}
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => onNavigate(item.view)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
            </button>
          ))}
        </section>
      ))}
    </nav>
  );
}
