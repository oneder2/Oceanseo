import { dateFromKey, dateKey } from "./dateUtils";
import type { Countdown, CountdownDraft } from "./types";

const STORAGE_KEY = "tideplan.countdowns.v1";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = dateFromKey(value);
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

function isCountdown(value: unknown): value is Countdown {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Countdown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.targetDate === "string"
    && isDateKey(item.targetDate)
    && typeof item.notes === "string"
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string";
}

function normalizeDraft(draft: CountdownDraft): CountdownDraft | null {
  const normalized = {
    title: draft.title.trim(),
    targetDate: draft.targetDate,
    notes: draft.notes.trim(),
  };
  return normalized.title && isDateKey(normalized.targetDate) ? normalized : null;
}

export function loadCountdowns(): Countdown[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isCountdown) : [];
  } catch {
    return [];
  }
}

export function saveCountdowns(countdowns: Countdown[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(countdowns));
}

export function createCountdown(draft: CountdownDraft): Countdown | null {
  const normalized = normalizeDraft(draft);
  if (!normalized) return null;
  const now = new Date().toISOString();
  return { id: createId(), ...normalized, createdAt: now, updatedAt: now };
}

export function updateCountdown(countdown: Countdown, draft: CountdownDraft): Countdown | null {
  const normalized = normalizeDraft(draft);
  if (!normalized) return null;
  return { ...countdown, ...normalized, updatedAt: new Date().toISOString() };
}

export function countdownDays(targetDate: string, today = dateKey()) {
  const target = dateFromKey(targetDate).getTime();
  const current = dateFromKey(today).getTime();
  return Math.round((target - current) / 86_400_000);
}

export function countdownLabel(days: number) {
  if (days === 0) return "就是今天";
  return days > 0 ? `还有 ${days} 天` : `已经 ${Math.abs(days)} 天`;
}
