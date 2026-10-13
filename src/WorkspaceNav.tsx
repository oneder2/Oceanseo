import WorkspaceControls from "./personal/WorkspaceControls";
import { personalEnabled } from "./personal/runtime";
import { useState } from "react";
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
  Server,
  Search,
  X,
} from "lucide-react";
import type { View } from "./types";
import { platform, viewAvailable } from "./platform";
import { registeredNavigation } from "./modules/catalog";
import { useCapabilities } from "./modules/useCapabilities";

const icons: Record<View, typeof Gauge> = {
  overview: Gauge, goals: Compass, calendar: CalendarRange, countdowns: Hourglass,
  people: Users, today: Sparkles, all: LayoutList, completed: Archive,
  infrastructure: Server, "work-monitor": Radar, "bead-studio": Grid2X2,
  "meal-planner": ChefHat, "shopping-list": ShoppingBasket, fitness: Dumbbell, travel: MapPin,
};
const groups = registeredNavigation().map(group => ({
  ...group, items: group.items.map(item => ({ ...item, icon: icons[item.view] })),
}));

export default function WorkspaceNav({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  const [query, setQuery] = useState("");
  const capabilities = useCapabilities();
  if (personalEnabled()) return <nav className="main-nav workspace-nav" aria-label="工作区导航"><WorkspaceControls view={view} onNavigate={onNavigate}/></nav>;
  const navigation = groups;
  const filtered = navigation.map(group => ({ ...group, items: group.items.filter(item =>
    viewAvailable(item.view) && `${group.name} ${item.label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ) })).filter(group => group.items.length);
  return (
    <nav className="main-nav workspace-nav" aria-label="工作区导航">
      <div className="nav-search">
        <Search size={16} aria-hidden="true" />
        <input aria-label="搜索工具" placeholder="搜索工具" value={query} onChange={event => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="清除工具搜索" title="清除工具搜索" onClick={() => setQuery("")}><X size={16} /></button>}
      </div>
      {!filtered.length && <p className="nav-empty" role="status">没有匹配的工具</p>}
      {filtered.map((group) => (
        <section key={group.name} aria-label={group.name}>
          <h2>{group.name}</h2>
          {group.items.map((item) => (
            <button
              key={item.view}
              type="button"
              className={view === item.view ? "active" : ""}
              aria-current={view === item.view ? "page" : undefined}
              onClick={() => { setQuery(""); onNavigate(item.view); }}
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
