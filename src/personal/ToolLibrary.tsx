import { useState } from "react";
import { Archive } from "lucide-react";
import { moduleCatalog, type ModuleId } from "../modules/catalog";
import { capabilitySnapshot } from "../modules/capabilities";
import type { PersonalWorkspace } from "./model";
import { toolIcons } from "./toolIcons";

const categories: { label: string; modules: ModuleId[] }[] = [
  { label: "工作与规划", modules: ["goals", "work-monitor", "calendar", "countdowns"] },
  { label: "技术与服务", modules: ["infrastructure"] },
  { label: "生活与出行", modules: ["shopping-list", "meal-planner", "travel", "fitness", "people"] },
  { label: "创作", modules: ["bead-studio"] },
];
const descriptions: Partial<Record<ModuleId, string>> = {
  goals: "梳理想法，拆解目标和下一步行动", "work-monitor": "观察项目变化，整理进展与复盘",
  calendar: "把当前工作区的计划放入时间轴", countdowns: "记录值得期待的日期",
  infrastructure: "管理主机、服务与维护记录", "shopping-list": "整理采购清单，逐项完成",
  "meal-planner": "规划三餐，生成食材采购建议", travel: "安排路线与旅行日程",
  fitness: "规划训练并记录完成情况", people: "记录人物信息与偏好", "bead-studio": "创作和保存拼豆作品",
};
export default function ToolLibrary({ workspace, busy, onChange }: {
  workspace: PersonalWorkspace; busy: boolean; onChange: (next: PersonalWorkspace) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  return <div className="scene-library-body">
          <p>按场景添加工具；同一个工具在各工作区共享资料。</p>
          <label className="form-field"><span>搜索工具</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="名称或用途"/></label>
          {categories.map(category => <section key={category.label}><h3>{category.label}</h3><div className="scene-tool-grid">
            {category.modules.filter(id => capabilitySnapshot().modules[id].visible && moduleCatalog[id].platforms.includes("linux")
              && `${moduleCatalog[id].title} ${descriptions[id]}`.includes(query)).map(id => {
              const existing = workspace.tools.find(t => t.module === id);
              const enabled = existing && !existing.archived;
              const Icon = toolIcons[id] ?? Archive;
              return <article className="scene-tool-card" key={id} onPointerMove={event => {
                const box = event.currentTarget.getBoundingClientRect();
                event.currentTarget.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
                event.currentTarget.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
              }}><Icon size={20}/><h4>{moduleCatalog[id].title}</h4><p>{descriptions[id]}</p><small>共享资料 · 按场景显示</small>
                <button type="button" disabled={busy} onClick={() => void onChange({ ...workspace, tools: existing ? workspace.tools.map(t => t.id === existing.id ? { ...t, archived: !t.archived } : t) : [...workspace.tools, { id: crypto.randomUUID(), module: id, archived: false }] })}>{enabled ? "移除并保留资料" : existing ? "恢复工具" : "添加工具"}</button></article>;
            })}</div></section>)}
        </div>;
}
