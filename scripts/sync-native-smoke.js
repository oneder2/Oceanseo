// Run ONLY in com.tideplan.mobile.syncqa. Needs sync-qa-service.py + adb reverse.
async (page) => {
  const check = (v, message) => { if (!v) throw Error(message); };
  const nav = page.getByRole("navigation", { name: "手机主导航" });
  await nav.waitFor();
  await page.locator(".mobile-settings").click();
  const sync = page.getByRole("region", { name: "跨设备同步", exact: true });
  await sync.getByRole("textbox", { name: "同步服务地址" }).fill("http://127.0.0.1:4789");
  await sync.getByLabel("同步访问令牌", {exact:true}).fill("tideplan-local-test-token-not-for-production-123456");
  await sync.getByRole("button", {name:"保存同步配置",exact:true}).click();
  await sync.getByRole("button", {name:"检查更改",exact:true}).click();
  await sync.getByText("首次连接，确认同步内容", {exact:true}).waitFor();
  await sync.getByRole("button", {name:"确认同步并重新载入",exact:true}).click();
  await page.getByRole("dialog",{name:"偏好设置",exact:true}).waitFor({state:"hidden"});
  await nav.getByRole("button", {name:"工具",exact:true}).click();
  await page.getByRole("navigation", {name:"工作区导航"}).getByRole("button",{name:"计划日历",exact:true}).click();
  await page.getByRole("spinbutton", {name:"跳转年份"}).fill("2026");
  await page.getByRole("spinbutton", {name:"跳转年份"}).press("Enter");
  await nav.getByRole("button", {name:"工具",exact:true}).click();
  await page.getByRole("navigation", {name:"工作区导航"}).getByRole("button",{name:"所有计划",exact:true}).click();
  await page.getByRole("button", {name:"同步验收：电脑记录的计划的记事本",exact:true}).click();
  await page.getByRole("dialog").getByRole("textbox").fill("手机同步笔记");
  await page.getByRole("button", {name:"保存笔记",exact:true}).click();
  await page.locator(".task-card .check-button").click();
  await page.locator(".mobile-settings").click();
  await sync.getByRole("button", {name:"检查更改",exact:true}).click();
  await sync.getByRole("button", {name:"确认同步并重新载入",exact:true}).click();
  await page.getByRole("dialog",{name:"偏好设置",exact:true}).waitFor({state:"hidden"});
  const state = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_tasks"));
  check(state.length === 1 && state[0].notes === "手机同步笔记" && state[0].completed_at, "Phone state not durable");
  await page.locator(".mobile-settings").click();
  await sync.getByRole("button", {name:"导出上次同步前安全副本",exact:true}).waitFor();
  await sync.scrollIntoViewIfNeeded();
  // Android WebView CDP screenshots can hang even after successful native IPC.
  // Keep image capture separate from the behavioral assertions.
  console.log("PASS: native sync, notebook, completion, and recovery entry");
}
