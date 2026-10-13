import { LayoutGrid, Sun, Waves } from "lucide-react";
import type { View } from "./types";
import { viewAvailable } from "./platform";
import { useCapabilities } from "./modules/useCapabilities";

export default function MobileNav({ view, toolsOpen, onNavigate, onTools }: {
  view: View;
  toolsOpen: boolean;
  onNavigate: (view: View) => void;
  onTools: () => void;
}) {
  const capabilities = useCapabilities();
  const current = toolsOpen || !["overview", "today", "goals"].includes(view)
    ? "tools" : view === "goals" ? "goals" : "overview";
  return <nav className="mobile-nav" aria-label="手机主导航">
    {viewAvailable("overview") && <button aria-current={current === "overview" ? "page" : undefined} onClick={() => onNavigate("overview")}><Sun size={21}/><span>今天</span></button>}
    {viewAvailable("goals") && <button aria-current={current === "goals" ? "page" : undefined} onClick={() => onNavigate("goals")}><Waves size={23}/><span>助手</span></button>}
    <button aria-expanded={toolsOpen} aria-current={current === "tools" ? "page" : undefined} onClick={onTools}><LayoutGrid size={21}/><span>工具</span></button>
  </nav>;
}
