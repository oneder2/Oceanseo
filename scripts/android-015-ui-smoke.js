// Run after mobile-ui-smoke.js in an isolated browser session.
async (page) => {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const nav = page.getByRole("navigation", { name: "手机主导航" });
  await nav.getByRole("button", { name: "工具", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "采购清单", exact: true }).click();
  const name = "有机小番茄与早餐需要的其他蔬菜";
  await page.getByRole("textbox", { name: "物品名称", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "采购数量", exact: true }).fill("两大盒，约 1200 克");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).click();
  await page.getByRole("textbox", { name: "编辑采购数量", exact: true }).fill("约 1500 克");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  for (const [width, height] of [[320, 844], [390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    check(await page.locator(".workspace").evaluate(el => el.scrollWidth <= el.clientWidth), `Shopping overflow at ${width}`);
    check(await page.getByRole("button", { name: "分享清单", exact: true }).isEnabled(), "Share should be available for populated list");
    const button = await page.getByRole("button", { name: `编辑 ${name}`, exact: true }).boundingBox();
    check(button.width >= 44 && button.height >= 44, "Small shopping touch target");
    await page.screenshot({ path: `output/playwright/android-015-shopping-${width}.png` });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("tab", { name: /^AI 食谱/ }).click();
  check(await page.getByRole("button", { name: "分享清单", exact: true }).isDisabled(), "Empty source should not be shareable");
  await page.locator(".mobile-settings").click();
  const panel = page.getByRole("region", { name: "Android 提醒检查" });
  await panel.scrollIntoViewIfNeeded();
  check(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), "Reminder panel overflows");
  for (const name of ["通知设置", "频道设置", "电池设置"]) {
    check(await panel.getByRole("button", { name, exact: true }).count() === 1, `Missing ${name}`);
  }
  await page.screenshot({ path: "output/playwright/android-015-reminders-320.png" });
  await page.evaluate(() => window.__tideplanBack());
}
