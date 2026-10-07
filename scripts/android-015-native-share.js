// Only on an isolated QA installation. Adds one synthetic purchase; opens the
// system chooser, but never selects a recipient or sends anything externally.
async (page) => {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_mobile_reminder_status"));
  check(status.permission && status.scheduled && status.nextTimes.length === 2, "Native schedule status missing");
  if (await page.getByRole("dialog", { name: "偏好设置", exact: true }).count()) {
    await page.evaluate(() => window.__tideplanBack());
  }
  await page.getByRole("navigation", { name: "手机主导航" }).getByRole("button", { name: "工具", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "采购清单", exact: true }).click();
  const name = "Android 分享验收 · 番茄";
  await page.getByRole("textbox", { name: "物品名称", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "采购数量", exact: true }).fill("2 斤");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).waitFor();
  await page.getByRole("combobox", { name: "导出格式", exact: true }).selectOption("csv");
  await page.getByRole("button", { name: "分享清单", exact: true }).click();
}
