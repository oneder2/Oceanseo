import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyGoals,
  isGoalState,
  goalSnapshot,
  type GoalState,
} from "../src/goals/model";
import {
  acceptDialogue,
  currentProposal,
  deliveryRows,
  dialogueContext,
  executeDelivery,
  executableKeys,
  parseDialogueReply,
} from "../src/goals/dialogue";
import {
  addMessage,
  emptyConversation,
  validUnderstanding,
} from "../src/goals/conversationData";
import reply from "./fixtures/dialogue-reply.json";
import type { Task } from "../src/types";
function state() {
  const s = emptyGoals();
  return acceptDialogue(s, parseDialogueReply(structuredClone(reply)), s, []);
}
function apply(s: GoalState, tasks: Task[], keys: string[]) {
  const result = executeDelivery(
    s,
    tasks,
    currentProposal(s)!.id,
    keys,
    crypto.randomUUID(),
  );
  result.next.revision = s.revision + 1;
  return {
    s: result.next,
    tasks: [
      ...tasks.map((t) => result.updated.find((u) => u.id === t.id) ?? t),
      ...result.created,
    ],
  };
}
test("dialogue executes clear rows while unrelated uncertainty blocks only its branch", () => {
  let s = state();
  const keys = executableKeys(deliveryRows(s, currentProposal(s)!));
  assert.deepEqual(keys, ["g:release", "a:verify"]);
  const result = apply(s, [], keys);
  s = result.s;
  assert.equal(result.tasks.length, 1);
  assert.equal(s.goals.length, 1);
  assert.equal(s.conversation!.receipts.length, 2);
  assert.equal(currentProposal(s)!.plan.goals.length, 1);
  assert.equal(currentProposal(s)!.plan.actions[0].id, "travel");
  assert.ok(isGoalState(s));
  assert.throws(() =>
    executeDelivery(
      s,
      result.tasks,
      currentProposal(s)!.id,
      ["a:verify"],
      "op",
    ),
  );
  assert.equal(executableKeys(deliveryRows(s, currentProposal(s)!)).length, 0);
});
test("single execution requires dependencies; partial receipt allows next row without duplicates", () => {
  const initial = state();
  assert.throws(() => apply(initial, [], ["a:verify"]), /依赖/);
  const first = apply(initial, [], ["g:release"]);
  assert.equal(first.tasks.length, 0);
  const next = apply(first.s, [], ["a:verify"]);
  assert.equal(next.tasks.length, 1);
  assert.equal(next.s.conversation!.receipts.length, 2);
  assert.equal(next.s.undo!.conversation!.receipts.length, 1);
  assert.ok(
    next.s.undo!.proposalBefore!.plan.actions.some((a) => a.id === "verify"),
  );
});
test("new messages and stale state block execution; dialogue preserves edited parameters in context", () => {
  const s = state(),
    p = currentProposal(s)!;
  p.plan.actions[0].minutes = 40;
  p.plan.actions[0].draft.dueDate = "2026-10-10";
  assert.equal(dialogueContext(s, []).pending!.plan.actions[0].minutes, 40);
  s.conversation = {
    ...addMessage(s.conversation!, "user", "这件事先暂停"),
    needsReply: true,
  };
  assert.equal(executableKeys(deliveryRows(s, p)).length, 0);
  s.conversation.needsReply = false;
  s.goals.push({ ...reply.plan.goals[0], status: "paused" });
  assert.throws(
    () => executeDelivery(s, [], p.id, ["g:release"], "op"),
    /已变化/,
  );
});
test("existing task edits preserve private notes and completion and snapshot before/after for undo", () => {
  const initial = state(),
    first = apply(initial, [], ["g:release", "a:verify"]),
    t = first.tasks[0];
  t.notes = "private notebook";
  t.completedAt = "2026-09-20T12:00:00.000Z";
  const output = parseDialogueReply(structuredClone(reply));
  output.plan.goals = [];
  output.plan.questions = [];
  output.waiting = [];
  output.plan.actions = [
    {
      ...output.plan.actions[0],
      existingTaskId: t.id,
      draft: {
        ...output.plan.actions[0].draft,
        dueDate: "2026-10-10",
        notes: "AI must not overwrite this",
      },
    },
  ];
  const s = acceptDialogue(first.s, output, first.s, [t]);
  const result = executeDelivery(
    s,
    [t],
    currentProposal(s)!.id,
    ["a:verify"],
    "op",
  );
  assert.equal(result.created.length, 0);
  assert.equal(result.updated.length, 1);
  assert.equal(result.updated[0].notes, "private notebook");
  assert.equal(result.updated[0].completedAt, t.completedAt);
  assert.equal(result.updated[0].dueDate, "2026-10-10");
  assert.deepEqual(result.next.undo!.updatedTasks![0].before, t);
  assert.equal(currentProposal(result.next), undefined);
  assert.ok(isGoalState(result.next));
});
test("a repeated AI action cannot lose its task link; an independent action keeps the original intact", () => {
  const first = apply(state(), [], ["g:release", "a:verify"]);
  const before = structuredClone(first);
  const output = parseDialogueReply(structuredClone(reply));
  output.plan.actions[0].draft.title = "独立最终验收";
  const invalid = acceptDialogue(first.s, output, first.s, first.tasks);
  assert.throws(() => apply(invalid, first.tasks, ["a:verify"]), /已有行动必须保留关联的任务/);
  assert.deepEqual(first, before);

  output.plan.actions[0].id = "verify-final";
  const independent = acceptDialogue(first.s, output, first.s, first.tasks);
  const result = apply(independent, first.tasks, ["a:verify-final"]);
  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks[0], before.tasks[0]);
  assert.equal(result.tasks[1].title, "独立最终验收");
  assert.notEqual(result.tasks[1].id, before.tasks[0].id);
  assert.equal(result.s.actions.find(action => action.id === "verify")!.taskId, before.tasks[0].id);
  assert.equal(result.s.conversation!.receipts.at(-1)!.taskId, result.tasks[1].id);
});
test("echoed executed objects are removed from new checklists regardless of key order", () => {
  const first = apply(state(), [], ["g:release", "a:verify"]),
    output = parseDialogueReply(structuredClone(reply));
  output.plan.questions = [];
  output.waiting = [];
  output.plan.goals = [output.plan.goals[0]];
  output.plan.actions = [
    { ...output.plan.actions[0], existingTaskId: first.tasks[0].id },
  ];
  const s = acceptDialogue(first.s, output, first.s, first.tasks);
  assert.equal(currentProposal(s)!.plan.goals.length, 0);
  assert.equal(currentProposal(s)!.plan.actions.length, 0);
  assert.equal(s.conversation!.receipts.length, 2);
});
test("malformed understanding, unspecified blocked scope and stale parameter replies are rejected", () => {
  assert.equal(
    validUnderstanding([
      { id: "a", parentId: "a", label: "cycle", status: "clear", evidence: "" },
    ]),
    false,
  );
  assert.throws(() => parseDialogueReply({ ...reply, waiting: [] }), /受影响/);
  assert.throws(
    () =>
      parseDialogueReply({
        ...reply,
        waiting: [{ key: "a:missing", reason: "unknown" }],
      }),
    /没有对应/,
  );
  const s = state(),
    snapshot = structuredClone(s);
  currentProposal(s)!.plan.actions[0].minutes = 45;
  assert.throws(
    () => acceptDialogue(s, parseDialogueReply(reply), snapshot, []),
    /参数已变化/,
  );
  const old = emptyGoals();
  assert.ok(isGoalState(old));
  assert.ok(isGoalState({ ...old, conversation: emptyConversation() }));
  assert.equal(
    isGoalState({
      ...old,
      conversation: { ...emptyConversation(), messages: [{ id: "bad" }] },
    }),
    false,
  );
});
test("reloaded modified tasks invalidate execution and completed proposal never reveals an older pending draft", () => {
  const first = apply(state(), [], ["g:release", "a:verify"]),
    t = first.tasks[0];
  const output = parseDialogueReply(structuredClone(reply));
  output.plan.questions = [];
  output.waiting = [];
  output.plan.goals = [];
  output.plan.actions = [
    {
      ...output.plan.actions[0],
      existingTaskId: t.id,
      draft: { ...output.plan.actions[0].draft, priority: "normal" },
    },
  ];
  const s = acceptDialogue(first.s, output, first.s, [t]);
  assert.throws(
    () =>
      executeDelivery(
        s,
        [{ ...t, updatedAt: "2099-01-01T00:00:00.000Z" }],
        currentProposal(s)!.id,
        ["a:verify"],
        "op",
      ),
    /关联任务已变化/,
  );
  const done = apply(s, [t], ["a:verify"]);
  done.s.proposals.unshift({
    ...currentProposal(s)!,
    id: "older",
    goalSnapshot: goalSnapshot(done.s),
  });
  assert.equal(currentProposal(done.s), undefined);
});
test("unchanged uncertain parents still block new dependent rows and pending reused tasks do not leak notebooks", () => {
  const first = apply(state(), [], ["g:release", "a:verify"]),
    output = parseDialogueReply(structuredClone(reply));
  output.plan.goals = [output.plan.goals[0]];
  output.plan.actions = [
    {
      ...output.plan.actions[0],
      id: "verify2",
      existingTaskId: "",
      draft: { ...output.plan.actions[0].draft, title: "进一步验证" },
    },
  ];
  output.waiting = [{ key: "g:release", reason: "新增事项的范围还需要确认" }];
  const s = acceptDialogue(first.s, output, first.s, first.tasks);
  assert.equal(executableKeys(deliveryRows(s, currentProposal(s)!)).length, 0);
  currentProposal(s)!.plan.actions[0].existingTaskId = first.tasks[0].id;
  currentProposal(s)!.plan.actions[0].draft.notes =
    "private notebook from a legacy draft";
  assert.equal(
    dialogueContext(s, first.tasks).pending!.plan.actions[0].draft.notes,
    "",
  );
});
