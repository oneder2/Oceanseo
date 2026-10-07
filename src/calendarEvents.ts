import { completedDateKey } from "./dateUtils";
import type { Countdown, Task } from "./types";
import type { LifeEvent } from "./life/model";
import type { HostEvent } from "./infrastructure/model";

export type CalendarEvent =
  | { type: "host"; event: HostEvent; kind: "host"; label: string }
  | { type: "task"; task: Task; kind: "start" | "due" | "completed"; label: string }
  | { type: "countdown"; countdown: Countdown; kind: "countdown"; label: string }
  | { type: "life"; event: LifeEvent; kind: "training" | "travel"; label: string };

// Index once per data change, rather than scanning every record for 42 cells.
export function calendarEventIndex(tasks: Task[], countdowns: Countdown[], life: LifeEvent[] = [], hosts: HostEvent[] = []) {
  const index = new Map<string, CalendarEvent[]>();
  const add = (date: string, event: CalendarEvent) => {
    if (!date) return;
    const events = index.get(date);
    if (events) events.push(event);
    else index.set(date, [event]);
  };
  for (const event of hosts) add(event.date, { type: "host", event, kind: "host", label: event.kind });
  for (const event of life) add(event.date, { type: "life", event, kind: event.kind,
    label: event.kind === "training" ? event.done ? "训练已完成" : "训练待清点" : "旅行安排" });
  for (const countdown of countdowns) add(countdown.targetDate, { type: "countdown", countdown, kind: "countdown", label: "关键日期" });
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  for (const task of tasks) {
    add(task.startDate, { type: "task", task, kind: "start", label: "开始" });
    add(task.dueDate, { type: "task", task, kind: "due", label: "截止" });
    if (task.completedAt) add(completedDateKey(task.completedAt), { type: "task", task, kind: "completed", label: `完成 ${time.format(new Date(task.completedAt))}` });
  }
  return index;
}
