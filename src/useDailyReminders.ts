import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { dateKey } from "./dateUtils";
import { countdownDays } from "./countdownStore";
import type { Countdown, ReminderSettings, Task } from "./types";

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

function reminderBody(tasks: Task[], countdowns: Countdown[], advanceDays: number) {
  const today = dateKey();
  const active = tasks.filter((task) => !task.completedAt);
  const startsToday = active.filter((task) => task.startDate === today).length;
  const dueToday = active.filter((task) => task.dueDate === today).length;
  const overdue = active.filter((task) => task.dueDate && task.dueDate < today).length;

  const parts = [];
  if (startsToday) parts.push(`${startsToday} 项今天开始`);
  if (dueToday) parts.push(`${dueToday} 项今天截止`);
  if (overdue) parts.push(`${overdue} 项已逾期`);
  const upcomingCountdowns = countdowns.filter((countdown) => {
    const days = countdownDays(countdown.targetDate, today);
    return days >= 0 && days <= advanceDays;
  });
  if (upcomingCountdowns.length) {
    const nearest = [...upcomingCountdowns].sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0];
    const days = countdownDays(nearest.targetDate, today);
    parts.push(`${upcomingCountdowns.length} 个关键日期临近，最近是${days === 0 ? "今天" : `${days} 天后`}的“${nearest.title}”`);
  }
  return parts.length ? `${parts.join("，")}。` : `当前还有 ${active.length} 项计划在进行。`;
}

async function ensurePermission() {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export function useDailyReminders(tasks: Task[], countdowns: Countdown[], settings: ReminderSettings) {
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
              body: reminderBody(tasks, countdowns, settings.countdownAdvanceDays),
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
  }, [settings.enabled, settings.times, settings.countdownAdvanceDays, tasks, countdowns]);

  async function sendTest() {
    if (!isTauri()) return false;
    try {
      if (!(await ensurePermission())) {
        setAvailable(false);
        return false;
      }
      sendNotification({ title: "潮汐计划", body: reminderBody(tasks, countdowns, settings.countdownAdvanceDays) });
      setAvailable(true);
      return true;
    } catch {
      setAvailable(false);
      return false;
    }
  }

  return { available, sendTest };
}
