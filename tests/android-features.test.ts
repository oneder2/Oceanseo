import test from "node:test";
import assert from "node:assert/strict";
import { mobileReminderMessage, type MobileReminderStatus } from "../src/mobileReminders";
import { purchaseExportDocument } from "../src/shoppingStore";
import type { PurchaseItem } from "../src/types";

const allowed: MobileReminderStatus = {
  permission: true, scheduled: true, appNotifications: true, channelEnabled: true,
  batteryOptimized: true, powerSaveMode: false, nextTimes: [1790600400000], timeZone: "America/New_York",
};

test("Android reminder guidance distinguishes disabled, permission, channel and scheduling failures", () => {
  assert.match(mobileReminderMessage(false, allowed), /已关闭/);
  assert.match(mobileReminderMessage(true, { ...allowed, permission: false, appNotifications: false }), /应用通知未获准/);
  assert.match(mobileReminderMessage(true, { ...allowed, permission: false, channelEnabled: false }), /频道已关闭/);
  assert.match(mobileReminderMessage(true, { ...allowed, scheduled: false }), /尚未安排/);
  assert.match(mobileReminderMessage(true, allowed), /可能延迟/);
});

const items: PurchaseItem[] = [
  { id: "one", name: '番茄,"小果"', amount: "2 斤", category: "蔬菜", checked: false, source: "manual", sourceId: null, sourceLabel: null, createdAt: "", updatedAt: "" },
  { id: "two", name: "鸡蛋", amount: "6 个", category: "肉蛋", checked: true, source: "ai-recipe", sourceId: "plan", sourceLabel: "本周食谱", createdAt: "", updatedAt: "" },
];

test("shopping share document preserves quantities, check state and AI source without mutating records", () => {
  const before = structuredClone(items);
  const md = purchaseExportDocument(items, "markdown");
  assert.match(md.content, /- \[x\] 鸡蛋 · 6 个 · AI 食谱：本周食谱/);
  assert.match(md.content, /- \[ \] 番茄/);
  const csv = purchaseExportDocument(items, "csv");
  assert.ok(csv.content.startsWith("\uFEFF"));
  assert.ok(csv.content.includes('"番茄,""小果"""'));
  assert.ok(csv.content.includes('"已采购","AI 食谱","本周食谱"'));
  assert.equal(csv.extension, "csv");
  assert.deepEqual(items, before);
});

test("source-filtered share contains only the chosen records", () => {
  const doc = purchaseExportDocument(items.filter(item => item.source === "ai-recipe"), "markdown");
  assert.ok(!doc.content.includes("番茄"));
  assert.ok(doc.content.includes("鸡蛋"));
});
