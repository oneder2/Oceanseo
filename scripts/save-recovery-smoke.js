// Isolated browser only; verifies the visible failure/retry path with a simulated storage quota error.
async (page) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "人物档案", exact: true }).click();
  await page.getByRole("textbox", { name: "姓名", exact: true }).fill("保存重试回归样例");
  await page.evaluate(() => {
    window.__originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("tideplan.outbox.v1:")) throw new DOMException("Test quota failure", "QuotaExceededError");
      return window.__originalStorageSet.call(this, key, value);
    };
  });
  try {
    await page.getByRole("button", { name: "保存档案", exact: true }).click();
    await page.getByText("自动保存尚未完成", { exact: true }).waitFor();
    await page.screenshot({ path: "output/playwright/release-0.9.1-save-error.png", fullPage: true, animations: "disabled" });
  } finally {
    await page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageSet; delete window.__originalStorageSet; });
  }
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await page.getByText("自动保存已完成", { exact: true }).waitFor();
  const name = await page.evaluate(() => JSON.parse(localStorage.getItem("tideplan.life.v1")).people[0].name);
  if (name !== "保存重试回归样例") throw Error("Retry lost the latest content");
  if (await page.getByText(/人物与生活计划尚未写入数据库/).count()) throw Error("Stale failure banner after successful retry");
  return { passed: true, scenario: "visible save failure and retry", name };
}
