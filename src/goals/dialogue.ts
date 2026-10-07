import type { Task } from "../types";
import {
  applyProposal,
  goalSnapshot,
  isPlan,
  mergedPlan,
  type GoalState,
  type Plan,
  type Proposal,
} from "./model";
import {
  addMessage,
  emptyConversation,
  validUnderstanding,
  validWaiting,
  type Conversation,
  type Understanding,
  type Waiting,
} from "./conversationData";

export interface DialogueReply {
  reply: string;
  understanding: Understanding[];
  waiting: Waiting[];
  plan: Plan;
}
export function parseDialogueReply(v: unknown): DialogueReply {
  const r = v as DialogueReply;
  if (
    !r ||
    typeof r.reply !== "string" ||
    !r.reply.trim() ||
    r.reply.length > 12000 ||
    !validUnderstanding(r.understanding) ||
    !validWaiting(r.waiting) ||
    !isPlan(r.plan) ||
    r.plan.questions.length > 2
  )
    throw Error("小汐的回复不完整，原话已保存，请重试。");
  const keys = new Set([
    ...r.plan.goals.map((g) => `g:${g.id}`),
    ...r.plan.actions.map((a) => `a:${a.id}`),
  ]);
  if (r.waiting.some((w) => !keys.has(w.key)))
    throw Error("待确认内容没有对应的更改，请重试。");
  // Unresolved assumptions/questions must name the affected rows. Never silently authorize all.
  if (
    (r.plan.questions.length || r.plan.assumptions.length) &&
    keys.size &&
    !r.waiting.length
  )
    throw Error("方案包含待确认信息，但未注明受影响的更改，请重试。");
  return r;
}
export function currentProposal(s: GoalState) {
  if (s.conversation?.proposalId)
    return s.proposals.find(
      (p) => p.id === s.conversation!.proposalId && p.status === "pending",
    );
  return s.proposals.filter((p) => p.status === "pending").at(-1);
}
export function conversationFor(s: GoalState): Conversation {
  if (s.conversation) return s.conversation;
  let c = emptyConversation();
  for (const t of s.thoughts.filter((t) => t.status === "inbox").slice(-60))
    c = addMessage(c, "user", t.text);
  const p = currentProposal(s);
  if (p) {
    c = addMessage(
      c,
      "assistant",
      p.plan.summary +
        (p.plan.questions.length ? "\n\n" + p.plan.questions.join("\n") : ""),
    );
    c.proposalId = p.id;
  }
  return c;
}
export function acceptDialogue(
  s: GoalState,
  reply: DialogueReply,
  snapshot: GoalState,
  tasks: Task[],
): GoalState {
  const canonical = (v: unknown) =>
    JSON.stringify(v, (_k, x) =>
      x && typeof x === "object" && !Array.isArray(x)
        ? Object.fromEntries(
            Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
          )
        : x,
    );
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  const uncertain = new Set(reply.waiting.map((w) => w.key));
  // Do not re-list unchanged objects after execution, even if the model echoes them.
  const plan = {
    ...reply.plan,
    goals: reply.plan.goals.filter(
      (g) => uncertain.has(`g:${g.id}`) || !s.goals.some((old) => same(old, g)),
    ),
    actions: reply.plan.actions.filter((a) => {
      if (uncertain.has(`a:${a.id}`)) return true;
      const old = s.actions.find((x) => x.id === a.id),
        task = tasks.find((t) => t.id === a.existingTaskId);
      if (!old || !task) return true;
      const { taskId, ...meta } = old;
      const { draft, existingTaskId, ...proposed } = a;
      return (
        taskId !== existingTaskId ||
        !same(meta, proposed) ||
        ["title", "horizon", "priority", "startDate", "dueDate"].some(
          (k) => task[k as keyof Task] !== draft[k as keyof typeof draft],
        )
      );
    }),
  };
  const kept = new Set([
    ...plan.goals.map((g) => `g:${g.id}`),
    ...plan.actions.map((a) => `a:${a.id}`),
  ]);
  reply = {
    ...reply,
    plan,
    waiting: reply.waiting.filter((w) => kept.has(w.key)),
  };
  const error = mergedPlan(s, reply.plan).error;
  if (error) throw Error(error);
  if (goalSnapshot(s) !== goalSnapshot(snapshot))
    throw Error("对话期间目标发生了变化，请重试，以最新记录继续。");
  const p: Proposal = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sourceIds: s.thoughts.filter((t) => t.status === "inbox").map((t) => t.id),
    goalSnapshot: goalSnapshot(s),
    taskVersions: Object.fromEntries(tasks.map((t) => [t.id, t.updatedAt])),
    status: "pending",
    plan: reply.plan,
    waiting: reply.waiting,
  };
  const c = addMessage(conversationFor(s), "assistant", reply.reply);
  const old = currentProposal(s);
  if (JSON.stringify(currentProposal(snapshot)) !== JSON.stringify(old))
    throw Error("清单参数已变化，请根据最新微调重新生成回复。");
  // Supersede only the active pending draft, preserving older execution receipts and proposals.
  return {
    ...s,
    proposals: [...s.proposals.filter((x) => x.id !== old?.id), p],
    conversation: {
      ...c,
      understanding: reply.understanding,
      proposalId: p.id,
      needsReply: false,
    },
  };
}
export interface DeliveryRow {
  key: string;
  title: string;
  kind: "goal" | "action";
  reason: string;
  dependencies: string[];
}
export function deliveryRows(s: GoalState, p: Proposal): DeliveryRow[] {
  const waits = new Map((p.waiting ?? []).map((w) => [w.key, w.reason]));
  const legacyUnclear =
    p.waiting === undefined &&
    !!(p.plan.questions.length || p.plan.assumptions.length);
  const stale = goalSnapshot(s) !== p.goalSnapshot;
  const reason = (key: string) =>
    s.conversation?.needsReply
      ? "有新消息尚待梳理，请先继续对话"
      : stale
        ? "目标已变化，请通过对话更新清单"
        : waits.get(key) ||
          (legacyUnclear ? "旧方案尚有待确认内容，请通过对话继续" : "");
  const pending = new Set([
    ...p.plan.goals.map((g) => `g:${g.id}`),
    ...p.plan.actions.map((a) => `a:${a.id}`),
  ]);
  return [
    ...p.plan.goals.map((g) => ({
      key: `g:${g.id}`,
      title: g.title,
      kind: "goal" as const,
      reason: reason(`g:${g.id}`),
      dependencies:
        g.parentId && pending.has(`g:${g.parentId}`) ? [`g:${g.parentId}`] : [],
    })),
    ...p.plan.actions.map((a) => ({
      key: `a:${a.id}`,
      title: a.draft.title,
      kind: "action" as const,
      reason: reason(`a:${a.id}`),
      dependencies: [
        `g:${a.goalId}`,
        ...a.dependsOn.map((id) => `a:${id}`),
      ].filter((k) => pending.has(k)),
    })),
  ];
}
export function executableKeys(rows: DeliveryRow[], requested?: string) {
  const selected = new Set<string>();
  // Existing prerequisites only need to be present in the app, not completed, to create a dependency.
  for (let pass = 0; pass <= rows.length; pass++)
    for (const r of rows)
      if (
        (!requested || requested === r.key) &&
        !r.reason &&
        r.dependencies.every((k) => selected.has(k))
      )
        selected.add(r.key);
  return [...selected];
}
export function executeDelivery(
  s: GoalState,
  tasks: Task[],
  proposalId: string,
  keys: string[],
  operationId: string,
) {
  const p = s.proposals.find(
    (p) => p.id === proposalId && p.status === "pending",
  );
  if (!p) throw Error("这份清单已经更新或执行，请检查当前清单。");
  const rows = deliveryRows(s, p),
    selected = new Set(keys);
  if (!selected.size || keys.some((k) => !rows.some((r) => r.key === k)))
    throw Error("没有可执行的更改。");
  for (const r of rows.filter((r) => selected.has(r.key))) {
    if (r.reason) throw Error(r.reason);
    if (r.dependencies.some((k) => !selected.has(k)))
      throw Error("请先执行依赖的目标或行动，或选择全部可执行项。");
  }
  const partial: Proposal = {
    ...p,
    plan: {
      ...p.plan,
      questions: [],
      assumptions: [],
      goals: p.plan.goals.filter((g) => selected.has(`g:${g.id}`)),
      actions: p.plan.actions.filter((a) => selected.has(`a:${a.id}`)),
    },
  };
  const change = applyProposal(s, partial, tasks, operationId);
  const now = new Date().toISOString();
  const updated = partial.plan.actions
    .filter((a) => a.existingTaskId)
    .flatMap((a) => {
      const before = tasks.find((t) => t.id === a.existingTaskId)!;
      // Notes remain private and cannot be replaced by a planning summary.
      const fields = {
        title: a.draft.title,
        horizon: a.draft.horizon,
        priority: a.draft.priority,
        startDate: a.draft.startDate,
        dueDate: a.draft.dueDate,
      };
      if (
        Object.entries(fields).every(([k, v]) => before[k as keyof Task] === v)
      )
        return [];
      const stamp = new Date(
        Math.max(Date.now(), Date.parse(before.updatedAt) + 1),
      ).toISOString();
      return [{ ...before, ...fields, updatedAt: stamp }];
    });
  const remaining: Proposal = {
    ...p,
    plan: {
      ...p.plan,
      goals: p.plan.goals.filter((g) => !selected.has(`g:${g.id}`)),
      actions: p.plan.actions.filter((a) => !selected.has(`a:${a.id}`)),
    },
    waiting: p.waiting?.filter((w) => !selected.has(w.key)),
    goalSnapshot: goalSnapshot(change.next),
    taskVersions: {
      ...p.taskVersions,
      ...Object.fromEntries(updated.map((t) => [t.id, t.updatedAt])),
    },
  };
  const finished =
    !remaining.plan.goals.length && !remaining.plan.actions.length;
  const receipts = rows
    .filter((r) => selected.has(r.key))
    .map((r) => {
      const action = change.next.actions.find((a) => `a:${a.id}` === r.key);
      return {
        id: crypto.randomUUID(),
        key: r.key,
        title: r.title,
        description:
          r.kind === "goal"
            ? s.goals.some((g) => `g:${g.id}` === r.key)
              ? "已更新目标"
              : "已添加目标"
            : partial.plan.actions.find((a) => `a:${a.id}` === r.key)
                  ?.existingTaskId
              ? "已关联事项并保存参数与执行入口"
              : "已添加事项及执行入口",
        taskId: action?.taskId ?? "",
        goalId: action?.goalId ?? r.key.slice(2),
        createdAt: now,
      };
    });
  const c = conversationFor(s);
  const next: GoalState = {
    ...change.next,
    thoughts: finished ? change.next.thoughts : s.thoughts,
    proposals: s.proposals.map((x) =>
      x.id === p.id ? (finished ? { ...p, status: "applied" } : remaining) : x,
    ),
    conversation: {
      ...addMessage(
        c,
        "system",
        `已执行 ${receipts.length} 项更改：${receipts.map((r) => r.title).join("、")}。`,
      ),
      receipts: [...c.receipts, ...receipts],
    },
  };
  next.undo = {
    ...change.next.undo!,
    conversation: c,
    proposalBefore: p,
    updatedTasks: updated.map((after) => ({
      before: tasks.find((t) => t.id === after.id)!,
      after,
    })),
  };
  return { ...change, next, updated };
}
export function dialogueContext(s: GoalState, tasks: Task[]) {
  const c = conversationFor(s),
    p = currentProposal(s);
  return {
    history: c.messages.slice(-40),
    historyTruncated: c.messages.length > 40,
    understanding: c.understanding,
    pending: p
      ? {
          plan: {
            ...p.plan,
            actions: p.plan.actions.map((a) =>
              a.existingTaskId ? { ...a, draft: { ...a.draft, notes: "" } } : a,
            ),
          },
          waiting: p.waiting ?? [],
        }
      : null,
    receipts: c.receipts.slice(-100),
    receiptsTruncated: c.receipts.length > 100,
    // Existing task notes are deliberately omitted; draft.notes is only for new tasks.
    existingTaskParameters: tasks.slice(0, 300).map((t) => ({
      id: t.id,
      title: t.title,
      horizon: t.horizon,
      priority: t.priority,
      startDate: t.startDate,
      dueDate: t.dueDate,
    })),
  };
}
