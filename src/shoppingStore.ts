import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { MealPlan, PurchaseItem, PurchaseItemDraft, ShoppingExportFormat } from "./types";

const STORAGE_KEY = "tideplan.purchase-list.v1";
const MEAL_PLAN_STORAGE_KEY = "tideplan.meal-plan.v1";
const MEAL_CHECKED_STORAGE_KEY = "tideplan.shopping-checked.v1";

export const DEFAULT_PURCHASE_CATEGORIES = ["蔬菜水果", "肉蛋水产", "粮油主食", "乳品豆制品", "调味干货", "日用清洁", "其他"];

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDraft(draft: PurchaseItemDraft): PurchaseItemDraft {
  return {
    name: draft.name.trim(),
    amount: draft.amount.trim(),
    category: draft.category.trim() || "其他",
  };
}

function isPurchaseItem(value: unknown): value is PurchaseItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PurchaseItem>;
  return typeof item.id === "string"
    && typeof item.name === "string"
    && typeof item.amount === "string"
    && typeof item.category === "string"
    && typeof item.checked === "boolean"
    && (item.source === "manual" || item.source === "ai-recipe")
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string";
}

export function loadPurchaseItems(): PurchaseItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isPurchaseItem).filter((item) => item.source === "manual")
      : [];
  } catch {
    return [];
  }
}

export function savePurchaseItems(items: PurchaseItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.filter((item) => item.source === "manual")));
}

export function loadMealPlan(): MealPlan | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEAL_PLAN_STORAGE_KEY) ?? "null") as Partial<MealPlan> | null;
    return parsed
      && typeof parsed.planTitle === "string"
      && typeof parsed.weekSummary === "string"
      && Array.isArray(parsed.days)
      && Array.isArray(parsed.shoppingList)
      ? parsed as MealPlan
      : null;
  } catch {
    return null;
  }
}

export function saveMealPlan(plan: MealPlan | null) {
  if (plan) localStorage.setItem(MEAL_PLAN_STORAGE_KEY, JSON.stringify(plan));
  else localStorage.removeItem(MEAL_PLAN_STORAGE_KEY);
}

export function loadMealCheckedItems(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEAL_CHECKED_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function saveMealCheckedItems(items: string[]) {
  localStorage.setItem(MEAL_CHECKED_STORAGE_KEY, JSON.stringify(items));
}

export function createPurchaseItem(draft: PurchaseItemDraft): PurchaseItem | null {
  const normalized = normalizeDraft(draft);
  if (!normalized.name) return null;
  const now = new Date().toISOString();
  return {
    id: createId(),
    ...normalized,
    checked: false,
    source: "manual",
    sourceLabel: null,
    sourceId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function updatePurchaseItem(item: PurchaseItem, draft: PurchaseItemDraft): PurchaseItem | null {
  const normalized = normalizeDraft(draft);
  if (!normalized.name) return null;
  return { ...item, ...normalized, updatedAt: new Date().toISOString() };
}

function stableHash(content: string) {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function planFingerprint(plan: MealPlan) {
  const content = JSON.stringify([plan.planTitle, plan.shoppingList]);
  return `meal-${stableHash(content)}`;
}

export function mealShoppingItemKey(category: string, name: string) {
  return `${category}\u0000${name}`;
}

export function createMealPurchaseItems(plan: MealPlan | null, checkedItems: string[]): PurchaseItem[] {
  if (!plan) return [];
  const sourceId = planFingerprint(plan);
  const checked = new Set(checkedItems);
  const derived: PurchaseItem[] = [];

  for (const [groupIndex, group] of plan.shoppingList.entries()) {
    for (const [itemIndex, item] of group.items.entries()) {
      const draft = normalizeDraft({ name: item.name, amount: item.amount, category: group.category });
      if (!draft.name) continue;
      const itemKey = mealShoppingItemKey(draft.category, draft.name);
      derived.push({
        id: `${sourceId}-${stableHash(`${groupIndex}\u0000${itemIndex}\u0000${itemKey}\u0000${draft.amount}`)}`,
        ...draft,
        checked: checked.has(itemKey),
        source: "ai-recipe",
        sourceLabel: plan.planTitle,
        sourceId,
        createdAt: sourceId,
        updatedAt: sourceId,
      });
    }
  }

  return derived;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function exportedAt() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function markdownContent(items: PurchaseItem[]) {
  const groups = new Map<string, PurchaseItem[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  const lines = ["# 采购清单", "", `导出时间：${exportedAt()}`, ""];
  for (const [category, group] of groups) {
    lines.push(`## ${category}`, "");
    for (const item of group) {
      const amount = item.amount ? ` · ${item.amount}` : "";
      const source = item.source === "ai-recipe" ? ` · AI 食谱：${item.sourceLabel ?? "未命名食谱"}` : " · 手动添加";
      lines.push(`- [${item.checked ? "x" : " "}] ${item.name}${amount}${source}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function csvContent(items: PurchaseItem[]) {
  const rows = ["物品,数量,分类,状态,来源,来源详情"];
  for (const item of items) {
    rows.push([
      item.name,
      item.amount,
      item.category,
      item.checked ? "已采购" : "待采购",
      item.source === "ai-recipe" ? "AI 食谱" : "手动添加",
      item.sourceLabel ?? "",
    ].map(csvCell).join(","));
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

export async function exportPurchaseItems(items: PurchaseItem[], format: ShoppingExportFormat) {
  const content = format === "csv" ? csvContent(items) : markdownContent(items);
  const extension = format === "csv" ? "csv" : "md";
  const fileName = `采购清单-${new Date().toISOString().slice(0, 10)}.${extension}`;

  if (isTauri()) {
    const outputPath = await save({
      title: "导出采购清单",
      defaultPath: fileName,
      filters: [{
        name: format === "csv" ? "CSV 表格" : "Markdown 文档",
        extensions: [extension],
      }],
    });
    if (!outputPath) return false;
    await writeTextFile(outputPath, content);
    return true;
  }

  const type = format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8";
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}
