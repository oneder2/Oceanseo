import { useEffect, useRef, useState } from "react";
import { dateKey } from "../dateUtils";
import type { LifeData } from "../life/model";
import type { PurchaseItem, ReminderSettings, Task } from "../types";
import type { GoalController } from "./store";
import { localReview } from "./model";
import { dueGoalReviews } from "./rhythm";
export function useGoalRhythm(
  c: GoalController,
  tasks: Task[],
  life: LifeData,
  reminders: ReminderSettings,
  purchases: PurchaseItem[] = [],
) {
  const [, setToday] = useState(dateKey);
  const latest = useRef({ c, tasks, life, reminders, purchases }),
    running = useRef(false);
  latest.current = { c, tasks, life, reminders, purchases };
  useEffect(() => {
    async function tick() {
      setToday(dateKey());
      const { c, tasks, life, reminders, purchases } = latest.current;
      if (!c.loaded || !c.state.goals.length || running.current) return;
      const today = dateKey(),
        kinds = dueGoalReviews(c.state, reminders);
      if (!kinds.length) return;
      running.current = true;
      try {
        await c.update((s) => ({
          ...s,
          reviews: [
            ...s.reviews,
            ...kinds
              .filter(
                (kind) =>
                  !s.reviews.some((r) => r.date === today && r.kind === kind),
              )
              .map((kind) => localReview(s, tasks, life, kind, purchases)),
          ].slice(-200),
        }));
      } catch {
        /* Visible storage error is owned by controller. */
      } finally {
        running.current = false;
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 30000);
    const focus = () => void tick();
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [c.loaded]);
}
