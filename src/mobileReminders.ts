import { invoke } from "@tauri-apps/api/core";
import type { ReminderSettings } from "./types";

export interface MobileReminderStatus {
  permission: boolean;
  scheduled: boolean;
  appNotifications: boolean;
  channelEnabled: boolean;
  batteryOptimized: boolean;
  powerSaveMode: boolean;
  nextTimes: number[];
  timeZone: string;
}

export function mobileReminderMessage(enabled: boolean, status: MobileReminderStatus) {
  if (!enabled) return "每日提醒已关闭。测试通知不代表开启每日提醒。";
  if (!status.appNotifications) return "应用通知未获准。请授权通知，或打开系统通知设置。";
  if (!status.channelEnabled) return "“每日计划提醒”频道已关闭，请在频道设置中开启。";
  if (!status.permission) return "尚未获准发送通知，请检查系统通知设置。";
  return status.scheduled
    ? "提醒已交给 Android 调度。实际送达可能延迟，强行停止应用后需重新打开。"
    : "系统提醒尚未安排，请刷新状态重试。";
}
let queue: Promise<unknown> = Promise.resolve();

export function configureMobileReminders(settings: ReminderSettings) {
  // Serialize rapid edits and StrictMode mount retries so an old native request
  // cannot replace a newer schedule. Never cancel on React effect cleanup.
  const next = queue.catch(() => undefined).then(() => invoke<MobileReminderStatus>(
    "configure_mobile_reminders", { enabled: settings.enabled, times: settings.times },
  ));
  queue = next;
  return next;
}
