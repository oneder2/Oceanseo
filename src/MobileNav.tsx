import { LayoutGrid, Sun, Waves } from "lucide-react";
import type { View } from "./types";

export default function MobileNav({ view, toolsOpen, onNavigate, onTools }: {
  view: View;
  toolsOpen: boolean;
  onNavigate: (view: View) => void;
  onTools: () => void;
}) {
  const current = toolsOpen || !["overview", "today", "goals"].includes(view)
    ? "tools" : view === "goals" ? "goals" : "overview";
  return <nav className="mobile-nav" aria-label="手机主导航">
    <button aria-current={current === "overview" ? "page" : undefined} onClick={() => onNavigate("overview")}><Sun size={21}/><span>今天</span></button>
    <button aria-current={current === "goals" ? "page" : undefined} onClick={() => onNavigate("goals")}><Waves size={23}/><span>助手</span></button>
    <button aria-expanded={toolsOpen} aria-current={current === "tools" ? "page" : undefined} onClick={onTools}><LayoutGrid size={21}/><span>工具</span></button>
  </nav>;
}
