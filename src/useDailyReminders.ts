import { profileLocalStorage as localStorage } from "./profileStorage";
import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { platform } from "./platform";
import { configureMobileReminders, mobileReminderMessage, type MobileReminderStatus } from "./mobileReminders";
import { dateKey } from "./dateUtils";
import { countdownDays } from "./countdownStore";
import type { Countdown, ReminderSettings, Task } from "./types";
import type { LifeEvent } from "./life/model";
import { dueReminder } from "./reminderPolicy";
import { attention, type Infrastructure } from "./infrastructure/model";
const LEDGER = "tideplan.notification-ledger.v2";
function delivered(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LEDGER) ?? "[]");
    const old = localStorage.getItem("tideplan.last-notification.v1");
    return [
      ...(Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : []),
      ...(old ? [old] : []),
    ];
  } catch {
    return [];
  }
}
export function reminderBody(
  tasks: Task[],
  countdowns: Countdown[],
  advanceDays: number,
  events: LifeEvent[] = [],
  infrastructure?: Infrastructure,
) {
  const today = dateKey(),
    active = tasks.filter((t) => !t.completedAt),
    parts = [];
  const starts = active.filter((t) => t.startDate === today).length;
  const due = active.filter((t) => t.dueDate === today).length;
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today).length;
  if (starts) parts.push(`${starts} 项今天开始`);
  if (due) parts.push(`${due} 项今天截止`);
  if (overdue) parts.push(`${overdue} 项已逾期`);
  const training = events.filter(
    (e) => e.date === today && e.kind === "training" && !e.done,
  ).length;
  const travel = events.filter(
    (e) => e.date === today && e.kind === "travel",
  ).length;
  if (training) parts.push(`${training} 项训练待清点`);
  if (travel) parts.push(`${travel} 项今日旅行安排`);
  const hostCount = infrastructure ? attention(infrastructure, today).length : 0;
  if (hostCount) parts.push(`主机与服务有 ${hostCount} 项待留意，请打开面板核对`);
  const upcoming = countdowns.filter((c) => {
    const d = countdownDays(c.targetDate, today);
    return d >= 0 && d <= advanceDays;
  });
  if (upcoming.length) {
    const nearest = [...upcoming].sort((a, b) =>
      a.targetDate.localeCompare(b.targetDate),
    )[0];
    const days = countdownDays(nearest.targetDate, today);
    parts.push(
      `${upcoming.length} 个关键日期临近，最近是${days === 0 ? "今天" : `${days} 天后`}的“${nearest.title}”`,
    );
  }
  return parts.length
    ? `${parts.join("，")}。`
    : `当前还有 ${active.length} 项计划在进行。`;
}
async function ensurePermission() {
  return (
    (await isPermissionGranted()) || (await requestPermission()) === "granted"
  );
}
export function useDailyReminders(
  tasks: Task[],
  countdowns: Countdown[],
  settings: ReminderSettings,
  events: LifeEvent[] = [],
  ready = true,
  goalHint = "",
  infrastructure?: Infrastructure,
) {
  const [available, setAvailable] = useState(isTauri() && !platform.mobile);
  const currentSettings = useRef(settings);
  currentSettings.current = settings;
  const [mobileStatus, setMobileStatus] = useState("正在检查系统提醒…");
  const [mobileDetails, setMobileDetails] = useState<MobileReminderStatus | null>(null);
  const [mobileRefresh, setMobileRefresh] = useState(0);
  const [mobileChecking, setMobileChecking] = useState(false);
  useEffect(() => {
    if (platform.name !== "android" || !ready) return;
    let active = true;
    const update = () => {
      setMobileChecking(true);
      void configureMobileReminders(settings).then(status => {
        if (!active) return;
        setAvailable(status.permission);
        setMobileDetails(status);
        setMobileStatus(mobileReminderMessage(settings.enabled, status));
      }).catch(() => { if (active) {
        setMobileDetails(null);
        setMobileStatus("无法检查系统提醒，请刷新状态重试。");
      } }).finally(() => { if (active) setMobileChecking(false); });
    };
    update();
    const resume = () => { if (document.visibilityState === "visible") update(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { active = false; window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [ready, settings.enabled, settings.times[0], settings.times[1], mobileRefresh]);
  useEffect(() => {
    if (!isTauri() || platform.mobile || !settings.enabled || !ready) return;
    let cancelled = false,
      checking = false;
    async function check() {
      if (cancelled || checking) return;
      checking = true;
      try {
        const entry = dueReminder(new Date(), settings.times, delivered());
        if (!entry) return;
        const granted = await ensurePermission();
        if (cancelled) return;
        setAvailable(granted);
        if (!granted || delivered().includes(entry.key)) return;
        sendNotification({
          title: `潮汐计划 · ${entry.time} 提醒`,
          body: reminderBody(
            tasks,
            countdowns,
            settings.countdownAdvanceDays,
            events,
            infrastructure,
          ) + (goalHint ? ` ${goalHint}` : ""),
        });
        const now = new Date();
        // Collapse elapsed slots into one notification instead of a burst.
        const ledger = [...delivered(), entry.key];
        let next;
        while ((next = dueReminder(now, settings.times, ledger)))
          ledger.push(next.key);
        localStorage.setItem(LEDGER, JSON.stringify(ledger.slice(-32)));
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(() => void check(), 30000);
    const resume = () => {
      void check();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [settings, tasks, countdowns, events, ready, goalHint, infrastructure]);
  async function sendTest() {
    if (!isTauri()) return false;
    try {
      if (!(await ensurePermission())) {
        setAvailable(false);
        if (platform.name === "android") setMobileRefresh(value => value + 1);
        return false;
      }
      if (platform.name === "android") {
        const status = await configureMobileReminders(currentSettings.current);
        setAvailable(status.permission);
        setMobileDetails(status);
        setMobileStatus(mobileReminderMessage(currentSettings.current.enabled, status));
        if (!status.permission) {
          setMobileStatus("通知权限或“每日计划提醒”频道被关闭，请在 Android 系统设置中开启。");
          return false;
        }
        await invoke("plugin:notification|notify", { options: {
          id: 9199, channelId: "tideplan.daily.v1", icon: "ic_notification",
          title: "潮汐计划 · 测试通知", body: "通知已开启。每天按设定时间提醒你查看计划。",
        } });
        return true;
      }
      sendNotification({
        title: "潮汐计划",
        body: reminderBody(
          tasks,
          countdowns,
          settings.countdownAdvanceDays,
          events,
          infrastructure,
        ),
      });
      setAvailable(true);
      return true;
    } catch {
      setAvailable(false);
      return false;
    }
  }
  return { available, sendTest, mobileStatus, mobileDetails, mobileChecking, refreshMobile: () => setMobileRefresh(value => value + 1) };
}
