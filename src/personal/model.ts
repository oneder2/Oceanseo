import { moduleCatalog, type ModuleId } from "../modules/catalog";

export type WorkspaceStyle = "neutral" | "executive" | "technical" | "living" | "study";
export interface ToolInstance { id: string; module: ModuleId; archived: boolean }
export interface PersonalWorkspace {
  id: string; name: string; main: boolean; style: WorkspaceStyle;
  deleted: boolean; tools: ToolInstance[];
}
export interface PersonalWorkspaceDocument {
  version: 1; revision: number; activeId: string; workspaces: PersonalWorkspace[];
  taskOwners: Record<string, string>;
}
export const PENDING = "pending";
export const MAIN = "main";
export const styles: { id: WorkspaceStyle; label: string; description: string }[] = [
  { id: "neutral", label: "从容", description: "中性留白 · 自由组合" },
  { id: "executive", label: "决策", description: "墨蓝秩序 · 工作与创业参考" },
  { id: "technical", label: "探索", description: "石墨青色 · 技术与代码参考" },
  { id: "living", label: "日常", description: "暖白柔绿 · 生活参考" },
  { id: "study", label: "专注", description: "米白淡紫 · 学习参考" },
];
export function emptyWorkspaces(): PersonalWorkspaceDocument {
  return { version: 1, revision: 0, activeId: MAIN, taskOwners: {}, workspaces: [
    { id: MAIN, name: "主工作区", main: true, style: "neutral", deleted: false, tools: [] },
  ] };
}
export function validateDocument(value: unknown): value is PersonalWorkspaceDocument {
  if (!value || typeof value !== "object") return false;
  const d = value as PersonalWorkspaceDocument;
  if (d.version !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 0 || !Array.isArray(d.workspaces)
    || !d.taskOwners || typeof d.taskOwners !== "object" || Array.isArray(d.taskOwners)) return false;
  const ids = new Set<string>();
  const instances = new Set<string>();
  for (const w of d.workspaces) {
    if (!w || typeof w.id !== "string" || ids.has(w.id) || !/^(main|[0-9a-f-]{36})$/.test(w.id)
      || typeof w.name !== "string" || !w.name.trim() || w.name.length > 40 || typeof w.main !== "boolean"
      || typeof w.deleted !== "boolean" || !styles.some(s => s.id === w.style) || !Array.isArray(w.tools)) return false;
    ids.add(w.id);
    const active = new Set<string>();
    for (const t of w.tools) {
      if (!t || !/^[0-9a-f-]{36}$/.test(t.id) || instances.has(t.id) || typeof t.module !== "string" || !Object.hasOwn(moduleCatalog, t.module) || ["overview","tasks"].includes(t.module) || typeof t.archived !== "boolean") return false;
      if (!t.archived && active.has(t.module)) return false;
      if (!t.archived) active.add(t.module);
      instances.add(t.id);
    }
  }
  return d.workspaces.filter(w => w.main).length === 1
    && d.workspaces.some(w => w.main && w.id === MAIN && !w.deleted)
    && d.workspaces.some(w => w.id === d.activeId && !w.deleted)
    && Object.values(d.taskOwners).every(id => id === PENDING || d.workspaces.some(w => w.id === id && !w.deleted));
}
export function taskOwner(d: PersonalWorkspaceDocument, id: string) { return d.taskOwners[id] ?? PENDING; }
export function taskOwnerLabel(d: PersonalWorkspaceDocument, id: string) {
  const owner = taskOwner(d, id);
  return owner === PENDING ? "待定" : d.workspaces.find(w => w.id === owner)?.name ?? "待定";
}
export function ownershipRank(d: PersonalWorkspaceDocument, taskId: string) {
  if (d.activeId === MAIN) return 0;
  const owner = taskOwner(d, taskId);
  return owner === d.activeId ? 0 : owner === PENDING ? 1 : 2;
}
