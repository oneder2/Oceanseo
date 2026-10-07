import type { PurchaseItem, Task, TaskDraft, View } from "../types";
import type { LifeData } from "../life/model";
import { validDate, addDays } from "../life/model";
import { dateKey } from "../dateUtils";
import { validConditions, type GoalConditions } from "./handoff";
import { validConversation, validWaiting, type Conversation, type Waiting } from "./conversationData";

export const GOAL_KEY = "tideplan.goals.v1";
export const destinations = {
  task: "事项记事本",
  fitness: "训练计划",
  travel: "旅行规划",
  "shopping-list": "采购清单",
  "meal-planner": "AI 食谱",
  "work-monitor": "工作观察",
  "bead-studio": "拼豆图纸",
} as const;
export type Destination = keyof typeof destinations;
export interface GoalSeed {
  conditions?: GoalConditions;
  id: string;
  title: string;
  notes: string;
  startDate: string;
  dueDate: string;
}
export interface Goal {
  id: string;
  parentId: string;
  title: string;
  criterion: string;
  status: "active" | "paused" | "completed";
  reviewDate: string;
}
export interface Action {
  conditions?: GoalConditions;
  id: string;
  goalId: string;
  taskId: string;
  dependsOn: string[];
  minutes: number;
  energy: "low" | "normal" | "high";
  blocker: string;
  deferredUntil: string;
  destination: Destination;
  targetId: string;
  targetDate: string;
}
export interface Thought {
  id: string;
  text: string;
  status: "inbox" | "later" | "organized";
  createdAt: string;
}
export interface PlanAction extends Omit<Action, "taskId"> {
  existingTaskId: string;
  draft: TaskDraft;
}
export interface Plan {
  summary: string;
  questions: string[];
  assumptions: string[];
  later: string[];
  goals: Goal[];
  actions: PlanAction[];
}
export interface Proposal {
  waiting?: Waiting[];
  id: string;
  sourceIds: string[];
  createdAt: string;
  goalSnapshot: string;
  taskVersions: Record<string, string>;
  status: "pending" | "applied" | "undone";
  plan: Plan;
}
export interface Review {
  id: string;
  date: string;
  kind: "morning" | "evening" | "weekly";
  text: string;
  note: string;
  nextCheck: string;
  source: "local" | "ai";
}
export interface GoalState {
  conversation?: Conversation;
  version: 1;
  revision: number;
  thoughts: Thought[];
  draft: string;
  goals: Goal[];
  actions: Action[];
  proposals: Proposal[];
  reviews: Review[];
  preferences: {
    minutes: number;
    energy: Action["energy"];
    dailyLimit: number;
    checkins: boolean;
    autoReview: boolean;
    reviewTime: string;
    reviewWeekday: number;
  };
  operations: string[];
  undo: null | {
    operationId: string;
    revision: number;
    goals: Goal[];
    actions: Action[];
    thoughts: Thought[];
    createdTasks: Task[];
    proposalId: string;
    conversation?: Conversation;
    proposalBefore?: Proposal;
    updatedTasks?: { before: Task; after: Task }[];
  };
}
export const emptyGoals = (): GoalState => ({
  version: 1,
  revision: 0,
  thoughts: [],
  draft: "",
  goals: [],
  actions: [],
  proposals: [],
  reviews: [],
  preferences: {
    minutes: 60,
    energy: "normal",
    dailyLimit: 3,
    checkins: true,
    autoReview: false,
    reviewTime: "19:00",
    reviewWeekday: 0,
  },
  operations: [],
  undo: null,
});
const obj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, n = 4000): v is string =>
  typeof v === "string" && v.length <= n;
const id = (v: unknown): v is string =>
  text(v, 80) && /^[A-Za-z0-9_:-]+$/.test(v);
const date = (v: unknown) => v === "" || validDate(v);
const list = (v: unknown, n: number, fn: (x: any) => boolean): v is any[] =>
  Array.isArray(v) && v.length <= n && v.every(fn);
const unique = (v: { id: string }[]) =>
  new Set(v.map((x) => x.id)).size === v.length;
const int = (v: unknown, lo: number, hi: number) =>
  Number.isInteger(v) && Number(v) >= lo && Number(v) <= hi;
const goal = (g: any) =>
  obj(g) &&
  id(g.id) &&
  (g.parentId === "" || id(g.parentId)) &&
  text(g.title, 200) &&
  !!g.title.trim() &&
  text(g.criterion, 2000) &&
  ["active", "paused", "completed"].includes(g.status) &&
  date(g.reviewDate);
const action = (a: any) =>
  obj(a) &&
  id(a.id) &&
  id(a.goalId) &&
  list(a.dependsOn, 50, id) &&
  new Set(a.dependsOn).size === a.dependsOn.length &&
  int(a.minutes, 5, 1440) &&
  ["low", "normal", "high"].includes(a.energy) &&
  text(a.blocker, 1000) &&
  date(a.deferredUntil) &&
  Object.hasOwn(destinations, a.destination) &&
  (a.targetId === "" || id(a.targetId)) &&
  date(a.targetDate) &&
  validConditions(a.conditions);
export function graphError(
  goals: Goal[],
  actions: Pick<Action, "id" | "goalId" | "dependsOn">[],
): string {
  if (!unique(goals) || !unique(actions)) return "存在重复的目标或行动编号";
  const gs = new Map(goals.map((g) => [g.id, g])),
    as = new Map(actions.map((a) => [a.id, a]));
  for (const g of goals) {
    const seen = new Set<string>([g.id]);
    let parent = g.parentId;
    while (parent) {
      if (seen.has(parent)) return "目标不能循环包含";
      seen.add(parent);
      const p = gs.get(parent);
      if (!p) return "子目标缺少上级目标";
      parent = p.parentId;
    }
  }
  const done = new Set<string>(),
    visiting = new Set<string>();
  function visit(key: string): boolean {
    if (done.has(key)) return true;
    if (visiting.has(key)) return false;
    const a = as.get(key);
    if (!a) return false;
    visiting.add(key);
    if (!a.dependsOn.every(visit)) return false;
    visiting.delete(key);
    done.add(key);
    return true;
  }
  if (actions.some((a) => !gs.has(a.goalId))) return "行动缺少所属目标";
  if (actions.some((a) => !visit(a.id))) return "前置行动缺失或存在循环依赖";
  return "";
}
export function isPlan(v: unknown): v is Plan {
  if (
    !obj(v) ||
    !text(v.summary) ||
    !list(v.questions, 3, (x) => text(x, 500)) ||
    !list(v.assumptions, 12, (x) => text(x, 1000)) ||
    !list(v.later, 30, (x) => text(x, 1000)) ||
    !list(v.goals, 100, goal) ||
    !list(
      v.actions,
      100,
      (a) =>
        action(a) &&
        (a.existingTaskId === "" || id(a.existingTaskId)) &&
        obj(a.draft) &&
        text(a.draft.title, 200) &&
        !!a.draft.title.trim() &&
        text(a.draft.notes, 4000) &&
        ["short", "mid", "long"].includes(a.draft.horizon) &&
        ["normal", "important"].includes(a.draft.priority) &&
        date(a.draft.startDate) &&
        date(a.draft.dueDate) &&
        (!a.draft.startDate ||
          !a.draft.dueDate ||
          a.draft.startDate <= a.draft.dueDate),
    )
  )
    return false;
  return unique(v.goals) && unique(v.actions);
}
export function isGoalState(v: unknown): v is GoalState {
  if (
    !obj(v) ||
    (v.conversation !== undefined && !validConversation(v.conversation)) ||
    v.version !== 1 ||
    !int(v.revision, 0, Number.MAX_SAFE_INTEGER) ||
    !text(v.draft, 12000) ||
    !list(
      v.thoughts,
      500,
      (t) =>
        obj(t) &&
        id(t.id) &&
        text(t.text, 12000) &&
        ["inbox", "later", "organized"].includes(t.status) &&
        text(t.createdAt, 40) &&
        Number.isFinite(Date.parse(t.createdAt)),
    ) ||
    !unique(v.thoughts) ||
    !list(v.goals, 300, goal) ||
    !list(v.actions, 1000, (a) => action(a) && id(a.taskId)) ||
    graphError(v.goals, v.actions)
  )
    return false;
  const p = v.preferences;
  if (
    !obj(p) ||
    !int(p.minutes, 5, 1440) ||
    !int(p.dailyLimit, 1, 10) ||
    !["low", "normal", "high"].includes(p.energy) ||
    typeof p.checkins !== "boolean" ||
    typeof p.autoReview !== "boolean" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.reviewTime) ||
    !int(p.reviewWeekday, 0, 6)
  )
    return false;
  if (
    !list(
      v.proposals,
      100,
      (p) =>
        obj(p) &&
        id(p.id) &&
        list(p.sourceIds, 500, id) &&
        text(p.createdAt, 40) &&
        text(p.goalSnapshot, 300000) &&
        obj(p.taskVersions) &&
        Object.entries(p.taskVersions).every(
          ([k, val]) => id(k) && text(val, 40),
        ) &&
        ["pending", "applied", "undone"].includes(p.status) &&
        isPlan(p.plan) && (p.waiting === undefined || validWaiting(p.waiting)),
    ) ||
    !unique(v.proposals) ||
    !list(v.operations, 2000, id)
  )
    return false;
  if (
    !list(
      v.reviews,
      200,
      (r) =>
        obj(r) &&
        id(r.id) &&
        validDate(r.date) &&
        ["morning", "evening", "weekly"].includes(r.kind) &&
        text(r.text, 12000) &&
        text(r.note, 4000) &&
        date(r.nextCheck) &&
        ["local", "ai"].includes(r.source),
    )
  )
    return false;
  if (
    v.undo !== null &&
    (!obj(v.undo) ||
      !id(v.undo.operationId) ||
      !id(v.undo.proposalId) ||
      (v.undo.conversation !== undefined && !validConversation(v.undo.conversation)) ||
      (v.undo.proposalBefore !== undefined && (!obj(v.undo.proposalBefore) || !isPlan(v.undo.proposalBefore.plan))) ||
      (v.undo.updatedTasks !== undefined && !list(v.undo.updatedTasks, 100, p => obj(p) && obj(p.before) && obj(p.after) && id(p.before.id) && p.before.id === p.after.id && text(p.before.updatedAt,40) && text(p.after.updatedAt,40))) ||
      !int(v.undo.revision, 0, Number.MAX_SAFE_INTEGER) ||
      !list(v.undo.goals, 300, goal) ||
      !list(v.undo.actions, 1000, (a) => action(a) && id(a.taskId)) ||
      graphError(v.undo.goals, v.undo.actions) ||
      !list(
        v.undo.thoughts,
        500,
        (t) =>
          obj(t) &&
          id(t.id) &&
          text(t.text, 12000) &&
          ["inbox", "later", "organized"].includes(t.status),
      ) ||
      !list(
        v.undo.createdTasks,
        100,
        (t) =>
          obj(t) && id(t.id) && text(t.title, 200) && text(t.updatedAt, 40),
      ))
  )
    return false;
  return true;
}
export const goalSnapshot = (s: GoalState) =>
  JSON.stringify({ goals: s.goals, actions: s.actions });
export function mergedPlan(s: GoalState, p: Plan) {
  const goals = [
    ...s.goals.filter((g) => !p.goals.some((n) => n.id === g.id)),
    ...p.goals,
  ];
  const actions = [
    ...s.actions.filter((a) => !p.actions.some((n) => n.id === a.id)),
    ...p.actions,
  ];
  return { goals, actions, error: graphError(goals, actions) };
}
export function applyProposal(
  s: GoalState,
  proposal: Proposal,
  tasks: Task[],
  operationId: string,
) {
  if (proposal.status !== "pending")
    throw Error("这份方案已处理，请勿重复采用");
  if (
    proposal.sourceIds.some(
      (id) => !s.thoughts.some((t) => t.id === id && t.status === "inbox"),
    )
  )
    throw Error("原始想法已暂缓或已整理，请检查收集箱后重新整理");
  if (proposal.goalSnapshot !== goalSnapshot(s))
    throw Error("目标或行动已变化，请重新整理后采用");
  if (proposal.plan.questions.length)
    throw Error("请先回答待确认问题，再重新整理");
  if (
    proposal.plan.goals.some(
      (g) =>
        !s.goals.some((old) => old.id === g.id) && g.status === "completed",
    )
  )
    throw Error("新目标不能直接标记为已完成，请先检查完成标准");
  const merged = mergedPlan(s, proposal.plan);
  if (merged.error) throw Error(merged.error);
  const created: Task[] = [],
    used = new Set<string>();
  const now = new Date().toISOString();
  const additions: Action[] = proposal.plan.actions.map((a) => {
    let task = tasks.find((t) => t.id === a.existingTaskId);
    const oldAction = s.actions.find((old) => old.id === a.id);
    if (
      oldAction &&
      oldAction.taskId !== a.existingTaskId &&
      tasks.some((t) => t.id === oldAction.taskId)
    )
      throw Error("已有行动必须保留关联的任务");
    if (
      a.existingTaskId &&
      (!task || task.updatedAt !== proposal.taskVersions[a.existingTaskId])
    )
      throw Error("关联任务已变化或被删除，请重新整理");
    if (!task) {
      task = {
        ...a.draft,
        id: crypto.randomUUID(),
        schemaVersion: "1.0.0",
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        origin: {
          kind: "local",
          label: "小汐 · 目标方案",
          reference: proposal.id,
        },
      };
      created.push(task);
    }
    if (
      used.has(task.id) ||
      s.actions.some((old) => old.taskId === task!.id && old.id !== a.id)
    )
      throw Error("同一任务已关联行动，请复用该行动");
    used.add(task.id);
    const { draft: _draft, existingTaskId: _existing, ...meta } = a;
    return { ...meta, taskId: task.id };
  });
  const next: GoalState = {
    ...s,
    goals: merged.goals,
    actions: [
      ...s.actions.filter((a) => !additions.some((n) => n.id === a.id)),
      ...additions,
    ],
    thoughts: [
      ...s.thoughts.map((t): Thought =>
        proposal.sourceIds.includes(t.id) ? { ...t, status: "organized" } : t,
      ),
      ...proposal.plan.later
        .filter((text) => !s.thoughts.some((t) => t.text === text))
        .map((text, i): Thought => ({
          id: `${proposal.id}-later-${i}`,
          text,
          status: "later",
          createdAt: now,
        })),
    ],
    proposals: s.proposals.map((p) =>
      p.id === proposal.id ? { ...p, status: "applied" } : p,
    ),
    undo: {
      operationId,
      revision: s.revision + 1,
      goals: s.goals,
      actions: s.actions,
      thoughts: s.thoughts,
      createdTasks: created,
      proposalId: proposal.id,
    },
  };
  return {
    next,
    created,
    checks: proposal.plan.actions
      .filter((a) => a.existingTaskId)
      .map((a) => ({
        id: a.existingTaskId,
        updatedAt: proposal.taskVersions[a.existingTaskId],
      })),
  };
}
export function actionDone(
  a: Action,
  tasks: Task[],
  life?: LifeData,
  purchases: PurchaseItem[] = [],
) {
  if (tasks.find((t) => t.id === a.taskId)?.completedAt) return true;
  if (a.destination === "shopping-list" && a.targetId)
    return purchases.some((p) => p.id === a.targetId && p.checked);
  return (
    a.destination === "fitness" &&
    !!a.targetId &&
    !!a.targetDate &&
    !!life?.workouts.some(
      (w) => w.planId === a.targetId && w.date === a.targetDate && w.completed,
    )
  );
}
export function goalActive(s: GoalState, id: string): boolean {
  const g = s.goals.find((g) => g.id === id);
  return (
    !!g && g.status === "active" && (!g.parentId || goalActive(s, g.parentId))
  );
}
export function nextActions(
  s: GoalState,
  tasks: Task[],
  life?: LifeData,
  today = dateKey(),
  purchases: PurchaseItem[] = [],
) {
  const level = { low: 0, normal: 1, high: 2 };
  const candidates = s.actions.map((a) => {
    const task = tasks.find((t) => t.id === a.taskId),
      g = s.goals.find((g) => g.id === a.goalId);
    const waiting = a.dependsOn.filter((id) => {
      const prior = s.actions.find((a) => a.id === id);
      return !prior || !actionDone(prior, tasks, life, purchases);
    });
    let reason = !task
      ? "关联任务已删除，请重新关联"
      : !goalActive(s, a.goalId)
        ? "目标已暂停或结束"
        : a.blocker
          ? a.blocker
          : waiting.length
            ? `等待 ${waiting.length} 项前置行动`
            : a.deferredUntil > today
              ? `暂缓至 ${a.deferredUntil}`
              : task.startDate > today
                ? `${task.startDate} 开始`
                : a.minutes > s.preferences.minutes
                  ? "超过当前可用时间"
                  : level[a.energy] > level[s.preferences.energy]
                    ? "需要更充足的精力"
                    : "";
    const done = actionDone(a, tasks, life, purchases);
    const score =
      (task?.dueDate && task.dueDate <= today ? 1000 : 0) +
      (task?.priority === "important" ? 100 : 0) +
      s.actions.filter((b) => b.dependsOn.includes(a.id)).length * 10;
    return { action: a, task, goal: g, reason, done, score };
  });
  const available = candidates
    .filter((c) => !c.done && !c.reason)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task!.dueDate || "9999").localeCompare(b.task!.dueDate || "9999") ||
        a.action.minutes - b.action.minutes ||
        a.action.id.localeCompare(b.action.id),
    );
  let remaining = s.preferences.minutes,
    count = 0;
  const ready = available.filter((c) => {
    if (count >= s.preferences.dailyLimit || c.action.minutes > remaining)
      return false;
    remaining -= c.action.minutes;
    count++;
    return true;
  });
  return {
    ready,
    blocked: candidates.filter((c) => !c.done && c.reason),
    done: candidates.filter((c) => c.done),
    remaining,
  };
}
export function localReview(
  s: GoalState,
  tasks: Task[],
  life: LifeData,
  kind: Review["kind"],
  purchases: PurchaseItem[] = [],
): Review {
  const n = nextActions(s, tasks, life, undefined, purchases),
    today = dateKey();
  const completedToday = tasks.filter(
    (t) =>
      t.completedAt &&
      dateKey(new Date(t.completedAt)) === today &&
      s.actions.some((a) => a.taskId === t.id),
  );
  return {
    id: crypto.randomUUID(),
    date: today,
    kind,
    source: "local",
    note: "",
    nextCheck: addDays(today, kind === "weekly" ? 7 : 1),
    text: `${kind === "morning" ? "晨间安排" : kind === "evening" ? "晚间清点" : "周期复盘"}\n今天录入完成 ${completedToday.length} 项关联任务；累计完成 ${n.done.length}/${s.actions.length} 项行动。完成行动不等于已达到目标标准。\n${n.ready.length ? `接下来：${n.ready.map((c) => `${c.task!.title}（${c.action.minutes} 分钟）`).join("；")}` : "目前没有符合时间、精力和依赖条件的行动。"}\n${
      n.blocked.length
        ? `待处理阻碍：${n.blocked
            .slice(0, 5)
            .map((c) => `${c.task?.title || "缺失任务"}：${c.reason}`)
            .join("；")}`
        : "没有已记录的阻碍。"
    }\n未记录不等于未完成；请补充实际进展与需要调整的地方。`,
  };
}
export const destinationView = (a: Action): View =>
  a.destination === "task" ? "all" : a.destination;
