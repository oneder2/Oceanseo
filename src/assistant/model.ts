import type { TaskDraft, View } from "../types";
import { validDate } from "../life/model";

export const PAGES: Record<View, string> = {
  overview: "总览",
  goals: "想法与目标",
  today: "今天",
  all: "所有计划",
  calendar: "计划日历",
  countdowns: "关键日期",
  "meal-planner": "AI 食谱",
  "shopping-list": "采购清单",
  "work-monitor": "工作观察",
  completed: "完成记录",
  "bead-studio": "拼豆图纸",
  people: "人物档案",
  fitness: "训练计划",
  travel: "旅行规划",
};
export const SCOPES = {
  tasks: "任务摘要",
  calendar: "日历安排",
  meals: "饮食与采购",
  work: "项目进度",
} as const;
export type Scope = keyof typeof SCOPES;
export interface Persona {
  name: string;
  tone: "gentle" | "concise" | "coach";
  color: "sea" | "sunset";
  preferences: string;
}
export type AgentAction =
  | { id: string; type: "navigate"; view: View }
  | { id: string; type: "organize"; text: string }
  | { id: string; type: "task_draft"; draft: TaskDraft };
export type SavedAction = AgentAction & {
  status: "pending" | "opened" | "dismissed";
};
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  reads: Scope[];
  actions: SavedAction[];
}
export interface AssistantState {
  version: 1;
  persona: Persona;
  scopes: Scope[];
  messages: Message[];
  draft: string;
}
export const defaultAssistant = (): AssistantState => ({
  version: 1,
  persona: { name: "小汐", tone: "gentle", color: "sea", preferences: "" },
  scopes: ["tasks", "calendar"],
  messages: [],
  draft: "",
});
const str = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
export const isScope = (v: unknown): v is Scope =>
  typeof v === "string" && Object.hasOwn(SCOPES, v);
export function validDraft(v: unknown): v is TaskDraft {
  if (!v || typeof v !== "object") return false;
  const d = v as TaskDraft;
  return (
    str(d.title, 200) &&
    !!d.title.trim() &&
    str(d.notes, 12000) &&
    ["short", "mid", "long"].includes(d.horizon) &&
    ["normal", "important"].includes(d.priority) &&
    (d.startDate === "" || validDate(d.startDate)) &&
    (d.dueDate === "" || validDate(d.dueDate)) &&
    (!d.startDate || !d.dueDate || d.startDate <= d.dueDate)
  );
}
export function validAction(v: unknown): v is AgentAction {
  if (!v || typeof v !== "object") return false;
  const a = v as AgentAction;
  return (
    str(a.id, 80) &&
    !!a.id &&
    (a.type === "navigate"
      ? typeof a.view === "string" && Object.hasOwn(PAGES, a.view)
      : a.type === "organize" ? str(a.text,4000) && !!a.text.trim() : a.type === "task_draft" && validDraft(a.draft))
  );
}
export function isAssistantState(v: unknown): v is AssistantState {
  if (!v || typeof v !== "object") return false;
  const s = v as AssistantState,
    p = s.persona;
  return (
    s.version === 1 &&
    !!p &&
    str(p.name, 24) &&
    !!p.name.trim() &&
    ["gentle", "concise", "coach"].includes(p.tone) &&
    ["sea", "sunset"].includes(p.color) &&
    str(p.preferences, 1200) &&
    str(s.draft, 4000) &&
    Array.isArray(s.scopes) &&
    s.scopes.length <= 4 &&
    s.scopes.every(isScope) &&
    new Set(s.scopes).size === s.scopes.length &&
    Array.isArray(s.messages) &&
    s.messages.length <= 40 &&
    new Set(s.messages.map((m) => m?.id)).size === s.messages.length &&
    s.messages.every(
      (m) =>
        !!m &&
        str(m.id, 80) &&
        !!m.id &&
        ["user", "assistant"].includes(m.role) &&
        str(m.content, 12000) &&
        str(m.createdAt, 40) &&
        Number.isFinite(Date.parse(m.createdAt)) &&
        Array.isArray(m.reads) &&
        m.reads.length <= 4 &&
        m.reads.every(isScope) &&
        Array.isArray(m.actions) &&
        m.actions.length <= 6 &&
        new Set(m.actions.map((a) => a?.id)).size === m.actions.length &&
        m.actions.every(
          (a) =>
            validAction(a) &&
            ["pending", "opened", "dismissed"].includes(a.status),
        ),
    )
  );
}
export function historyForRequest(messages: Message[]) {
  // Keep complete recent user/assistant exchanges where possible. Actions are
  // factual UI status, never represented as already saved business records.
  const history = messages.slice(-12).map((m) => ({
    role: m.role,
    content:
      m.content +
      (m.actions.length
        ? "\n[操作卡状态；打开草稿不代表保存] " +
          m.actions
            .map(
              (a) =>
                `${a.type === "navigate" ? PAGES[a.view] : a.type === "organize" ? "想法已准备交给整理台" : a.draft.title}：${a.status === "opened" ? "用户已打开" : a.status === "dismissed" ? "用户已忽略" : "等待用户选择"}`,
            )
            .join("；")
        : ""),
  }));
  while (
    history.length > 2 &&
    new TextEncoder().encode(JSON.stringify(history)).length > 60_000
  )
    history.splice(0, 2);
  return history;
}
