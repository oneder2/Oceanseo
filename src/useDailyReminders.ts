import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { dateKey } from "./dateUtils";
import type { ReminderSettings, Task } from "./types";

const LAST_NOTIFICATION_KEY = "tideplan.last-notification.v1";

function nextReminderDate(times: string[]) {
  const now = new Date();
  const candidates = times.flatMap((time) => {
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return [];

    const today = new Date(now);
    today.setHours(hour, minute, 0, 0);
    if (today.getTime() > now.getTime() + 500) return [today];

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return [tomorrow];
  });

  return candidates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

function reminderBody(tasks: Task[]) {
  const today = dateKey();
  const active = tasks.filter((task) => !task.completedAt);
  const startsToday = active.filter((task) => task.startDate === today).length;
  const dueToday = active.filter((task) => task.dueDate === today).length;
  const overdue = active.filter((task) => task.dueDate && task.dueDate < today).length;

  const parts = [];
  if (startsToday) parts.push(`${startsToday} 项今天开始`);
  if (dueToday) parts.push(`${dueToday} 项今天截止`);
  if (overdue) parts.push(`${overdue} 项已逾期`);
  return parts.length ? `${parts.join("，")}。` : `当前还有 ${active.length} 项计划在进行。`;
}

async function ensurePermission() {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export function useDailyReminders(tasks: Task[], settings: ReminderSettings) {
  const [available, setAvailable] = useState(isTauri());

  useEffect(() => {
    if (!isTauri() || !settings.enabled) return;

    let timer = 0;
    let cancelled = false;

    const scheduleNext = async () => {
      try {
        if (!(await ensurePermission())) {
          if (!cancelled) setAvailable(false);
          return;
        }
        if (!cancelled) setAvailable(true);

        const next = nextReminderDate(settings.times);
        if (!next || cancelled) return;
        const delay = Math.max(0, next.getTime() - Date.now());

        timer = window.setTimeout(async () => {
          const time = next.toTimeString().slice(0, 5);
          const notificationKey = `${dateKey(next)}-${time}`;
          if (localStorage.getItem(LAST_NOTIFICATION_KEY) !== notificationKey) {
            sendNotification({
              title: `潮汐计划 · ${time} 提醒`,
              body: reminderBody(tasks),
            });
            localStorage.setItem(LAST_NOTIFICATION_KEY, notificationKey);
          }
          if (!cancelled) await scheduleNext();
        }, delay);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    };

    void scheduleNext();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settings.enabled, settings.times, tasks]);

  async function sendTest() {
    if (!isTauri()) return false;
    try {
      if (!(await ensurePermission())) {
        setAvailable(false);
        return false;
      }
      sendNotification({ title: "潮汐计划", body: reminderBody(tasks) });
      setAvailable(true);
      return true;
    } catch {
      setAvailable(false);
      return false;
    }
  }

  return { available, sendTest };
}
