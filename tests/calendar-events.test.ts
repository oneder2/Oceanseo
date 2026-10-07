import test from "node:test";
import assert from "node:assert/strict";
import { calendarEventIndex } from "../src/calendarEvents";
import { completedDateKey } from "../src/dateUtils";
import type { Task } from "../src/types";
import type { LifeEvent } from "../src/life/model";
import type { HostEvent } from "../src/infrastructure/model";

const task: Task = { schemaVersion: "1.0.0", id: "one", title: "Calendar fixture", notes: "", horizon: "short", priority: "normal",
  startDate: "2026-10-05", dueDate: "2026-10-05", createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-05T12:30:00Z",
  completedAt: "2026-10-05T12:30:00Z", origin: null };

test("calendar index preserves dates, order and all task milestones", () => {
  const countdown = { id: "date", title: "Date", targetDate: task.startDate, notes: "", createdAt: task.createdAt, updatedAt: task.updatedAt };
  const index = calendarEventIndex([task], [countdown]);
  const events = index.get(task.startDate)!;
  assert.deepEqual(events.slice(0, 3).map(event => event.kind), ["countdown", "start", "due"]);
  const completed = index.get(completedDateKey(task.completedAt))!.find(event => event.kind === "completed")!;
  assert.match(completed.label, /^完成 \d{2}:\d{2}$/);
  assert.equal(events[1].type === "task" && events[1].task, task);
  assert.equal(index.has(""), false);
  assert.equal(index.has("2030-01-01"), false);
});

test("calendar index keeps completion on the local date and ignores unset dates", () => {
  const input = { ...task, startDate: "", dueDate: "", completedAt: "2026-03-08T00:30:00Z" };
  const index = calendarEventIndex([input], []);
  assert.deepEqual([...index.keys()], [completedDateKey(input.completedAt)]);
  assert.equal(calendarEventIndex([{ ...input, completedAt: null }], []).size, 0);
});

test("calendar index preserves host, life, countdown and task ordering", () => {
  const life: LifeEvent[] = [{ id: "training", date: task.startDate, title: "Training", kind: "training", targetId: "plan", done: true },
    { id: "travel", date: task.startDate, title: "Travel", kind: "travel", targetId: "trip" }];
  const hosts: HostEvent[] = [{ id: "renewal", hostId: "host", title: "Renewal", date: task.startDate, kind: "renewal", remindDays: 7 }];
  const countdown = { id: "date", title: "Date", targetDate: task.startDate, notes: "", createdAt: task.createdAt, updatedAt: task.updatedAt };
  const events = calendarEventIndex([{ ...task, completedAt: null }], [countdown], life, hosts).get(task.startDate)!;
  assert.deepEqual(events.map(e => e.kind), ["host", "training", "travel", "countdown", "start", "due"]);
  assert.deepEqual(events.slice(1, 3).map(e => e.label), ["训练已完成", "旅行安排"]);
});

test("calendar index handles 10000 tasks without dropping or duplicating events", () => {
  const tasks = Array.from({ length: 10000 }, (_, i) => ({ ...task, id: String(i), completedAt: null }));
  const original = JSON.stringify(tasks);
  const index = calendarEventIndex(tasks, []);
  assert.equal(index.get(task.startDate)!.length, 20000);
  assert.equal(new Set(index.get(task.startDate)!.filter(e => e.type === "task").map(e => e.task.id)).size, 10000);
  assert.equal(JSON.stringify(tasks), original);
});
