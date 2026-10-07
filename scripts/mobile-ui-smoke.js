// Run against an isolated Vite preview with playwright-cli run-code.
// Exercises mobile rendering only; native SQLite/notifications need APK checks.
async (page) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const check = (value, message) => { if (!value) throw Error(message); };
  await page.evaluate(async () => {
    const { platform } = await import("/src/platform.ts");
    Object.assign(platform, { name: "android", mobile: true, desktop: false, workMonitor: false });
    document.documentElement.dataset.platform = "android";
  });
  // A previous run may already be in the mobile shell.
  if (await page.getByRole("navigation", { name: "手机主导航" }).count()) {
    await page.getByRole("navigation", { name: "手机主导航" }).getByRole("button", { name: "助手", exact: true }).click();
  } else await page.getByRole("button", { name: "想法与目标", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const chat = page.getByRole("textbox", { name: "给小汐的消息" });
  await chat.waitFor();
  await chat.fill("先整理这周要做的事");
  await chat.press("Enter");
  check((await chat.inputValue()).includes("\n"), "Mobile Enter sent instead of newline");
  await chat.fill("");
  check(await page.getByRole("button", { name: "隐藏到托盘" }).count() === 0, "Desktop window controls leaked");
  await page.screenshot({ path: "output/playwright/android-chat-preview.png" });
  const nav = page.getByRole("navigation", { name: "手机主导航" });
  await nav.getByRole("button", { name: "工具", exact: true }).click();
  const tools = page.getByRole("navigation", { name: "工作区导航" });
  check(await tools.getByRole("button", { name: "工作观察", exact: true }).count() === 0, "Desktop scan exposed");
  check(await tools.getByRole("button", { name: "拼豆图纸", exact: true }).count() === 0, "Desktop editor exposed");
  await page.screenshot({ path: "output/playwright/android-tools-preview.png" });
  await tools.getByRole("button", { name: "计划日历", exact: true }).click();
  await page.getByRole("spinbutton", { name: "跳转年份" }).fill("2032");
  await page.getByRole("spinbutton", { name: "跳转年份" }).press("Enter");
  check(await page.getByRole("spinbutton", { name: "跳转年份" }).inputValue() === "2032", "Calendar year jump failed");
  check(await page.evaluate(() => window.__tideplanBack?.()) === true, "Android back handler unavailable");
  await page.getByRole("button", { name: "添加计划", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "记下想完成的事" });
  await editor.getByRole("textbox", { name: "计划名称" }).fill("手机端验证计划");
  await editor.getByRole("button", { name: "截止日期：选择日期" }).click();
  await page.getByRole("dialog", { name: "截止日期选择器" }).getByRole("button", { name: "今天", exact: true }).click();
  await editor.getByRole("button", { name: "保存计划", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await nav.getByRole("button", { name: "工具", exact: true }).click();
  await tools.getByRole("button", { name: "所有计划", exact: true }).click();
  await page.getByRole("button", { name: "手机端验证计划的记事本", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("记得验证关闭后重新打开。");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflows at ${width}`);
    check(await page.locator(".workspace").evaluate(el => el.scrollWidth <= el.clientWidth), `Workspace overflows at ${width}`);
  }
  await page.screenshot({ path: "output/playwright/android-tasks-320-preview.png" });
  await page.locator(".mobile-settings").click();
  check(await page.getByRole("switch", { name: "开机自动启动" }).count() === 0, "Autostart exposed");
  await page.getByRole("region", { name: "跨设备同步", exact: true }).waitFor();
  check(await page.evaluate(() => window.__tideplanBack?.()) === true, "Back did not close settings");
  check(await page.getByRole("dialog", { name: "偏好设置" }).count() === 0, "Settings remained open");
  check(errors.length === 0, errors.join("\n"));
}
