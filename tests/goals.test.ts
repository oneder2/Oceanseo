import test from "node:test";
import assert from "node:assert/strict";
import {
  applyProposal,
  emptyGoals,
  goalSnapshot,
  graphError,
  isGoalState,
  isPlan,
  nextActions,
  actionDone,
  localReview,
  type Goal,
  type Action,
  type Proposal,
  type PlanAction,
} from "../src/goals/model";
import { planningContext } from "../src/goals/context";
import { emptyLife } from "../src/life/model";
import type { Task } from "../src/types";
import fixture from "./fixtures/goals-empty.json";
import { dueGoalReviews } from "../src/goals/rhythm";
const g: Goal = {
  id: "g1",
  parentId: "",
  title: "发布",
  criterion: "真实环境验收通过",
  status: "active",
  reviewDate: "",
};
const t: Task = {
  id: "t1",
  schemaVersion: "1.0.0",
  title: "升级验收",
  notes: "private-notebook",
  horizon: "short",
  priority: "important",
  startDate: "",
  dueDate: "",
  createdAt: "2026-09-20T12:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
  completedAt: null,
  origin: null,
};
const a: Action = {
  id: "a1",
  goalId: g.id,
  taskId: t.id,
  dependsOn: [],
  minutes: 25,
  energy: "normal",
  blocker: "",
  deferredUntil: "",
  destination: "task",
  targetId: "",
  targetDate: "",
};
function draftAction(): PlanAction {
  const { taskId: _, ...m } = a;
  return {
    ...m,
    existingTaskId: "",
    draft: {
      title: t.title,
      notes: "",
      horizon: t.horizon,
      priority: t.priority,
      startDate: "",
      dueDate: "",
    },
  };
}
function proposal(): Proposal {
  return {
    id: "p1",
    sourceIds: [],
    createdAt: t.createdAt,
    goalSnapshot: goalSnapshot(emptyGoals()),
    taskVersions: { t1: t.updatedAt },
    status: "pending",
    plan: {
      summary: "推进发布",
      questions: [],
      assumptions: [],
      later: [],
      goals: [g],
      actions: [draftAction()],
    },
  };
}
test("goal state validates persisted structure, references, cycles and old empty fixture", () => {
  assert.ok(isGoalState(fixture));
  assert.deepEqual(fixture, emptyGoals());
  assert.equal(graphError([g, { ...g, id: "g2", parentId: "g1" }], [a]), "");
  assert.ok(
    graphError(
      [
        { ...g, parentId: "g2" },
        { ...g, id: "g2", parentId: "g1" },
      ],
      [a],
    ),
  );
  assert.ok(
    graphError(
      [g],
      [
        { ...a, dependsOn: ["a2"] },
        { ...a, id: "a2", dependsOn: ["a1"] },
      ],
    ),
  );
  assert.ok(graphError([g], [{ ...a, dependsOn: ["missing"] }]));
  assert.equal(
    isGoalState({
      ...emptyGoals(),
      goals: [g],
      actions: [{ ...a, goalId: "missing" }],
    }),
    false,
  );
  assert.equal(
    isPlan({
      ...proposal().plan,
      actions: [
        {
          ...draftAction(),
          draft: { ...draftAction().draft, dueDate: "2026-02-30" },
        },
      ],
    }),
    false,
  );
});
test("one adoption preserves source and returns task IDs; reuse never overwrites notebooks", () => {
  const p = proposal(),
    s = {
      ...emptyGoals(),
      proposals: [p],
      thoughts: [
        {
          id: "i1",
          text: "混乱的原文",
          createdAt: t.createdAt,
          status: "inbox" as const,
        },
      ],
    };
  p.sourceIds = ["i1"];
  const result = applyProposal(s, p, [], "op1");
  assert.equal(result.created.length, 1);
  assert.equal(result.next.actions[0].taskId, result.created[0].id);
  assert.equal(result.next.thoughts[0].text, "混乱的原文");
  assert.equal(result.next.thoughts[0].status, "organized");
  assert.equal(result.next.proposals[0].status, "applied");
  assert.ok(isGoalState(result.next));
  p.plan.actions[0].existingTaskId = t.id;
  const reused = applyProposal(s, p, [t], "op2");
  assert.equal(reused.created.length, 0);
  assert.equal(reused.next.actions[0].taskId, t.id);
  assert.equal(t.notes, "private-notebook");
  assert.equal(reused.checks[0].updatedAt, t.updatedAt);
  assert.throws(
    () =>
      applyProposal(s, p, [{ ...t, updatedAt: "2026-09-21T00:00:00Z" }], "op3"),
    /已变化/,
  );
  assert.throws(
    () =>
      applyProposal(
        result.next,
        result.next.proposals[0],
        result.created,
        "op4",
      ),
    /已处理/,
  );
  assert.throws(
    () => applyProposal({ ...s, goals: [g] }, p, [t], "op5"),
    /目标或行动已变化/,
  );
});
test("questions and duplicate task links prevent adoption", () => {
  const p = proposal(),
    s = emptyGoals();
  p.plan.questions = ["哪个期限不能动？"];
  assert.throws(() => applyProposal(s, p, [], "op"), /回答/);
  p.plan.questions = [];
  p.plan.actions = [
    { ...draftAction(), existingTaskId: "t1" },
    { ...draftAction(), id: "a2", existingTaskId: "t1" },
  ];
  assert.throws(() => applyProposal(s, p, [t], "op"), /同一任务/);
});
test("next step unlocks only after dependency completion and obeys capacity, energy and pause", () => {
  const s = {
    ...emptyGoals(),
    goals: [g],
    actions: [
      a,
      { ...a, id: "a2", taskId: "t2", dependsOn: ["a1"] },
      { ...a, id: "a3", taskId: "t3", energy: "high" as const },
    ],
  };
  const tasks = [t, { ...t, id: "t2" }, { ...t, id: "t3" }];
  assert.deepEqual(
    nextActions(s, tasks).ready.map((c) => c.action.id),
    ["a1"],
  );
  assert.deepEqual(
    nextActions(s, [
      { ...t, completedAt: t.updatedAt },
      ...tasks.slice(1),
    ]).ready.map((c) => c.action.id),
    ["a2"],
  );
  assert.equal(
    nextActions({ ...s, goals: [{ ...g, status: "paused" }] }, tasks).ready
      .length,
    0,
  );
  assert.equal(
    nextActions({ ...s, preferences: { ...s.preferences, minutes: 15 } }, tasks)
      .ready.length,
    0,
  );
  const parallel = {
    ...s,
    actions: [
      a,
      { ...a, id: "a2", taskId: "t2" },
      { ...a, id: "a3", taskId: "t3" },
    ],
  };
  assert.equal(nextActions(parallel, tasks).ready.length, 2);
  assert.equal(nextActions(parallel, tasks).remaining, 10);
  assert.equal(
    nextActions(
      { ...parallel, preferences: { ...s.preferences, dailyLimit: 1 } },
      tasks,
    ).remaining,
    35,
  );
  assert.match(
    nextActions({ ...s, actions: [{ ...a, blocker: "等待测试机" }] }, tasks)
      .blocked[0].reason,
    /测试机/,
  );
});
test("business evidence distinguishes workout completion from simply having a plan", () => {
  const life = emptyLife(),
    linked = {
      ...a,
      destination: "fitness" as const,
      targetId: "plan1",
      targetDate: "2026-09-20",
    };
  assert.equal(actionDone(linked, [t], life), false);
  life.workouts = [
    {
      id: "w",
      planId: "plan1",
      date: "2026-09-20",
      actual: {},
      notes: "",
      completed: true,
      updatedAt: t.updatedAt,
    },
  ];
  assert.equal(actionDone(linked, [t], life), true);
  assert.equal(
    actionDone({ ...linked, targetDate: "2026-09-21" }, [t], life),
    false,
  );
  assert.ok(
    localReview(
      { ...emptyGoals(), goals: [g], actions: [linked] },
      [t],
      life,
      "weekly",
    ).text.includes("不等于"),
  );
});
test("planning context keeps raw thoughts durable and notebooks opt in", () => {
  const s = {
    ...emptyGoals(),
    thoughts: [
      {
        id: "i",
        text: "原文",
        status: "inbox" as const,
        createdAt: t.createdAt,
      },
    ],
  };
  const context = planningContext(s, [t], []);
  assert.ok(JSON.stringify(context).includes("原文"));
  assert.ok(!JSON.stringify(context).includes(t.notes));
  assert.ok(
    JSON.stringify(planningContext(s, [t], [], true)).includes(t.notes),
  );
});

test("postponed sources block stale adoption and deferred suggestions remain visible", () => {
  const p = proposal();
  p.sourceIds = ["source"];
  p.plan.later = ["以后学习摄影"];
  const s = {
    ...emptyGoals(),
    proposals: [p],
    thoughts: [
      {
        id: "source",
        text: "想法",
        status: "later" as const,
        createdAt: t.createdAt,
      },
    ],
  };
  assert.throws(() => applyProposal(s, p, [], "op"), /原始想法已暂缓/);
  const adopted = applyProposal(
    { ...s, thoughts: s.thoughts.map((t) => ({ ...t, status: "inbox" })) },
    p,
    [],
    "op",
  );
  assert.ok(
    adopted.next.thoughts.some(
      (t) => t.text === "以后学习摄影" && t.status === "later",
    ),
  );
});
test("daily and weekly checkins deduplicate persisted receipts and bound missed slots", () => {
  const s = { ...emptyGoals(), goals: [g] },
    reminders = {
      enabled: true,
      times: ["09:00", "19:00"] as [string, string],
      countdownAdvanceDays: 0,
    };
  assert.deepEqual(dueGoalReviews(s, reminders, new Date(2026, 8, 20, 9, 30)), [
    "morning",
  ]);
  assert.deepEqual(
    dueGoalReviews(s, reminders, new Date(2026, 8, 20, 12, 0)),
    [],
  );
  s.preferences.autoReview = true;
  assert.deepEqual(
    dueGoalReviews(s, reminders, new Date(2026, 8, 20, 19, 30)),
    ["evening", "weekly"],
  );
  s.reviews = [
    {
      id: "r",
      date: "2026-09-20",
      kind: "evening",
      text: "done",
      note: "",
      nextCheck: "",
      source: "local",
    },
  ];
  assert.deepEqual(
    dueGoalReviews(s, reminders, new Date(2026, 8, 20, 19, 30)),
    ["weekly"],
  );
});
test("purchased items unlock dependent actions without claiming a trip or project finished", () => {
  const purchase = {
    id: "p",
    name: "食材",
    amount: "1",
    category: "食品",
    checked: true,
    source: "manual" as const,
    sourceLabel: null,
    sourceId: null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  const linked = { ...a, destination: "shopping-list" as const, targetId: "p" };
  assert.equal(actionDone(linked, [t], emptyLife(), [purchase]), true);
  assert.equal(
    actionDone({ ...linked, destination: "travel" }, [t], emptyLife(), [
      purchase,
    ]),
    false,
  );
  const s = {
    ...emptyGoals(),
    goals: [g],
    actions: [linked, { ...a, id: "a2", taskId: "t2", dependsOn: ["a1"] }],
  };
  assert.deepEqual(
    nextActions(s, [t, { ...t, id: "t2" }], emptyLife(), "2026-09-20", [
      purchase,
    ]).ready.map((c) => c.action.id),
    ["a2"],
  );
});
