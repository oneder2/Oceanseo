import type { LifeData } from "../life/model";
import { trainingDates } from "../life/model";
import type { PurchaseItem, Task } from "../types";
import type { WorkDashboard } from "../workMonitorStore";
import { dateKey } from "../dateUtils";
import { platform } from "../platform";
import type { Destination, GoalState } from "./model";
import { can } from "../modules/capabilities";
export interface Target {
  id: string;
  title: string;
  destination: Destination;
  date: string;
}
export function businessTargets(
  life: LifeData,
  purchases: PurchaseItem[],
  work: WorkDashboard | null,
): Target[] {
  return [
    ...(can("fitness") ? life.training : [])
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        title: p.title,
        destination: "fitness" as const,
        date:
          trainingDates(p).find((d) => d >= dateKey()) ||
          trainingDates(p).at(-1) ||
          p.startDate,
      })),
    ...(can("travel") ? life.trips : []).map((p) => ({
      id: p.id,
      title: p.title,
      destination: "travel" as const,
      date: p.startDate,
    })),
    ...(can("shopping-list") ? purchases : []).map((p) => ({
      id: p.id,
      title: p.name + (p.checked ? "（已采购）" : ""),
      destination: "shopping-list" as const,
      date: "",
    })),
    ...(can("work-monitor") ? work?.projects ?? [] : []).map((p) => ({
      id: p.id,
      title: p.name,
      destination: "work-monitor" as const,
      date: "",
    })),
  ];
}
export function planningContext(
  s: GoalState,
  tasks: Task[],
  targets: Target[],
  shareNotes = false,
) {
  return {
    today: dateKey(),
    platform: platform.name,
    availableDestinations: (platform.mobile ? ["task", "fitness", "travel", "shopping-list"] : ["task", "fitness", "travel", "shopping-list", "work-monitor"]).filter(id => can(id === "task" ? "tasks" : id as Exclude<Destination, "task">, "write")),
    clarification: s.proposals
      .filter((p) => p.status === "pending")
      .slice(-1)
      .map((p) => ({
        summary: p.plan.summary,
        questions: p.plan.questions,
        assumptions: p.plan.assumptions,
      })),
    thoughts: s.thoughts
      .filter((t) => t.status === "inbox")
      .map((t) => ({ id: t.id, text: t.text })),
    goals: s.goals,
    actions: s.actions,
    capacity: s.preferences,
    tasks: (can("tasks") ? tasks : []).slice(0, 300).map((t) => ({
      id: t.id,
      title: t.title,
      horizon: t.horizon,
      priority: t.priority,
      startDate: t.startDate,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      ...(shareNotes ? { notes: t.notes } : {}),
    })),
    tasksTruncated: tasks.length > 300,
    targets: targets.slice(0, 200),
    targetsTruncated: targets.length > 200,
    recentDecisions: s.reviews
      .slice(-5)
      .map((r) => ({ date: r.date, note: r.note, nextCheck: r.nextCheck })),
  };
}
