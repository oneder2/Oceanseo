import { dateKey } from "../dateUtils";
import type { ReminderSettings } from "../types";
import type { GoalState, Review } from "./model";
export function dueGoalReviews(
  s: GoalState,
  reminders: ReminderSettings,
  now = new Date(),
): Review["kind"][] {
  if (!s.goals.length) return [];
  const today = dateKey(now),
    minutes = now.getHours() * 60 + now.getMinutes();
  const due = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const lag = minutes - h * 60 - m;
    return lag >= 0 && lag <= 120;
  };
  const kinds: Review["kind"][] = [];
  if (s.preferences.checkins && reminders.enabled) {
    const times = [...reminders.times].sort();
    if (due(times[0])) kinds.push("morning");
    if (due(times[1])) kinds.push("evening");
  }
  if (
    s.preferences.autoReview &&
    now.getDay() === s.preferences.reviewWeekday &&
    due(s.preferences.reviewTime)
  )
    kinds.push("weekly");
  return kinds.filter(
    (kind) => !s.reviews.some((r) => r.date === today && r.kind === kind),
  );
}
