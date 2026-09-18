import type { Countdown, MealPlan, PurchaseItem, Task, View } from "../types";
import type { LifeData } from "../life/model";
import { addDays, lifeEvents } from "../life/model";
import type { WorkDashboard } from "../workMonitorStore";
import type { Scope } from "./model";
import { dateKey } from "../dateUtils";

export interface AssistantData {
  tasks: Task[];
  countdowns: Countdown[];
  life: LifeData;
  purchases: PurchaseItem[];
  mealPlan: MealPlan | null;
  work: WorkDashboard | null;
  ready: boolean;
  view: View;
}
/** Construct an explicit allowlisted projection. Never spread source records:
 * task notebooks, birthdays, private notes, routes and local paths stay local. */
export function makeContext(
  data: AssistantData,
  scopes: Scope[],
  today = dateKey(),
) {
  const sections: Record<string, unknown> = {};
  const end = addDays(today, 13),
    start = addDays(today, -13);
  const shorten = (v: string, max = 200) => v.slice(0, max);
  if (scopes.includes("tasks")) {
    const pending = data.tasks
      .filter((t) => !t.completedAt)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    const recent = data.tasks.filter(
      (t) => t.completedAt && t.completedAt.slice(0, 10) >= start,
    );
    const summarize = (t: Task) => ({
      title: shorten(t.title),
      horizon: t.horizon,
      priority: t.priority,
      startDate: t.startDate,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
    });
    sections.tasks = {
      pendingCount: pending.length,
      pending: pending.slice(0, 80).map(summarize),
      recentCompletedCount: recent.length,
      recentCompleted: recent.slice(0, 30).map(summarize),
      truncated: pending.length > 80 || recent.length > 30,
    };
  }
  if (scopes.includes("calendar")) {
    const events = lifeEvents(data.life).filter(
      (e) => e.date >= today && e.date <= end,
    );
    sections.calendar = {
      from: today,
      through: end,
      events: events.slice(0, 80).map((e) => ({
        title: shorten(e.title),
        date: e.date,
        kind: e.kind,
        completed: e.done ?? null,
      })),
      keyDates: data.countdowns
        .filter((c) => c.targetDate >= today)
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
        .slice(0, 30)
        .map((c) => ({ title: shorten(c.title), date: c.targetDate })),
      truncated: events.length > 80,
    };
  }
  if (scopes.includes("meals"))
    sections.meals = {
      plan: data.mealPlan
        ? {
            title: shorten(data.mealPlan.planTitle),
            days: data.mealPlan.days.slice(0, 7).map((d) => ({
              weekday: d.weekday,
              breakfast: shorten(d.breakfast.name),
              lunch: shorten(d.lunch.name),
              dinner: shorten(d.dinner.name),
            })),
          }
        : null,
      shopping: data.purchases
        .filter((p) => !p.checked)
        .slice(0, 80)
        .map((p) => ({
          name: shorten(p.name),
          amount: shorten(p.amount, 80),
          category: shorten(p.category, 80),
        })),
      pendingCount: data.purchases.filter((p) => !p.checked).length,
    };
  if (scopes.includes("work"))
    sections.work = data.work
      ? {
          scannedAt: data.work.latestScan?.finishedAt ?? null,
          projects: data.work.projects.slice(0, 40).map((p) => ({
            name: shorten(p.name),
            commitCount: p.commitCount,
            changedFileCount: p.changedFileCount,
            activity: p.activityStatus,
            scannedAt: p.lastScannedAt,
          })),
          pendingReviews: data.work.drafts.filter((d) => d.status === "pending")
            .length,
          truncated: data.work.projects.length > 40,
        }
      : { available: false };
  return {
    today,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    currentView: data.view,
    sections,
  };
}
