import type { MealPlan, PurchaseItem, PurchaseItemDraft, ShoppingExportFormat } from "./types";

const STORAGE_KEY = "tideplan.purchase-list.v1";

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
    return Array.isArray(parsed) ? parsed.filter(isPurchaseItem) : [];
  } catch {
    return [];
  }
}

export function savePurchaseItems(items: PurchaseItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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

function planFingerprint(plan: MealPlan) {
  const content = JSON.stringify([plan.planTitle, plan.shoppingList]);
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `meal-${(hash >>> 0).toString(16)}`;
}

export function importMealPlan(current: PurchaseItem[], plan: MealPlan) {
  const sourceId = planFingerprint(plan);
  const existing = new Set(
    current
      .filter((item) => item.sourceId === sourceId)
      .map((item) => `${item.category}\u0000${item.name}\u0000${item.amount}`),
  );
  const now = new Date().toISOString();
  const imported: PurchaseItem[] = [];

  for (const group of plan.shoppingList) {
    for (const item of group.items) {
      const draft = normalizeDraft({ name: item.name, amount: item.amount, category: group.category });
      if (!draft.name) continue;
      const key = `${draft.category}\u0000${draft.name}\u0000${draft.amount}`;
      if (existing.has(key)) continue;
      existing.add(key);
      imported.push({
        id: createId(),
        ...draft,
        checked: false,
        source: "ai-recipe",
        sourceLabel: plan.planTitle,
        sourceId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return { items: [...imported, ...current], added: imported.length };
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

export function exportPurchaseItems(items: PurchaseItem[], format: ShoppingExportFormat) {
  const content = format === "csv" ? csvContent(items) : markdownContent(items);
  const extension = format === "csv" ? "csv" : "md";
  const type = format === "csv" ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8";
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `采购清单-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
