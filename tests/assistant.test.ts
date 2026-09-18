import test from "node:test";
import assert from "node:assert/strict";
import { makeContext, type AssistantData } from "../src/assistant/context";
import {
  defaultAssistant,
  historyForRequest,
  isAssistantState,
  validAction,
  validDraft,
  type Message,
} from "../src/assistant/model";
import { emptyLife } from "../src/life/model";

test("assistant context shares only selected projections, excluding notebooks and person data", () => {
  const data: AssistantData = {
    ready: true,
    view: "today",
    countdowns: [
      {
        id: "d",
        title: "生日提醒",
        targetDate: "2026-09-20",
        notes: "secret-countdown-note",
        createdAt: "",
        updatedAt: "",
      },
    ],
    tasks: [
      {
        schemaVersion: "1.0.0",
        id: "t",
        title: "整理发布计划",
        notes: "secret-notebook",
        horizon: "short",
        priority: "important",
        startDate: "",
        dueDate: "2026-09-20",
        createdAt: "",
        updatedAt: "",
        completedAt: null,
        origin: null,
      },
    ],
    life: {
      ...emptyLife(),
      people: [
        {
          id: "p",
          name: "secret-name",
          birthday: "1990-02-03",
          relationship: "",
          dietary: "",
          preferences: "",
          hobbies: "",
          strengths: "",
          healthNotes: "secret-health",
          notes: "secret-person-note",
          archived: false,
        },
      ],
    },
    purchases: [],
    mealPlan: null,
    work: null,
  };
  const context = makeContext(data, ["tasks"], "2026-09-18");
  assert.deepEqual(Object.keys(context.sections), ["tasks"]);
  assert.ok(JSON.stringify(context).includes("整理发布计划"));
  assert.ok(!JSON.stringify(context).includes("secret-"));
  assert.deepEqual(makeContext(data, [], "2026-09-18").sections, {});
  const all = JSON.stringify(
    makeContext(data, ["tasks", "calendar", "meals", "work"], "2026-09-18"),
  );
  assert.ok(!all.includes("secret-"));
  assert.ok(!all.includes("1990-02-03"));
  assert.ok(all.includes("生日提醒"));
});
test("assistant task proposals reject impossible dates, reversed ranges and unknown actions", () => {
  const draft = {
    title: "准备发布",
    notes: "",
    horizon: "short",
    priority: "normal",
    startDate: "2026-09-18",
    dueDate: "2026-09-20",
  };
  assert.ok(validDraft(draft));
  for (const invalid of [
    { dueDate: "2026-02-30" },
    { dueDate: "2026-09-17" },
    { title: " " },
    { horizon: "forever" },
  ])
    assert.equal(validDraft({ ...draft, ...invalid }), false);
  assert.ok(validAction({ id: "1", type: "task_draft", draft }));
  assert.equal(
    validAction({ id: "1", type: "navigate", view: "__proto__" }),
    false,
  );
  assert.equal(
    validAction({ id: "1", type: "shell", command: "anything" }),
    false,
  );
});
test("assistant conversation persistence validates proposals and keeps action status distinct from saved tasks", () => {
  const s = defaultAssistant();
  const m: Message = {
    id: "m",
    role: "assistant",
    content: "这是建议",
    createdAt: "2026-09-18T12:00:00.000Z",
    reads: ["tasks"],
    actions: [
      { id: "a", type: "navigate", view: "calendar", status: "opened" },
    ],
  };
  s.messages = [m];
  assert.ok(isAssistantState(s));
  assert.ok(historyForRequest(s.messages)[0].content.includes("不代表保存"));
  assert.ok(isAssistantState(JSON.parse(JSON.stringify(s))));
  assert.equal(isAssistantState({ ...s, messages: [m, m] }), false);
  assert.equal(isAssistantState({ ...s, scopes: ["tasks", "tasks"] }), false);
  assert.equal(
    isAssistantState({ ...s, persona: { ...s.persona, name: "" } }),
    false,
  );
  assert.equal(
    isAssistantState({
      ...s,
      messages: [{ ...m, actions: [{ ...m.actions[0], status: "executed" }] }],
    }),
    false,
  );
  assert.equal(
    historyForRequest(
      Array.from({ length: 40 }, (_, i) => ({ ...m, id: String(i) })),
    ).length,
    12,
  );
});
