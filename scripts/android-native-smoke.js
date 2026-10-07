// Run with playwright-cli attached to the isolated com.tideplan.mobile.uiuxqa
// WebView. Requires scripts/android-smoke-service.mjs + adb reverse 4319.
// This creates synthetic records and a synthetic local-service credential.
async (page) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const check = (value, message) => { if (!value) throw Error(message); };
  const nav = page.getByRole("navigation", { name: "手机主导航" });
  await nav.waitFor();
  check(await page.getByRole("button", { name: "窗口置顶" }).count() === 0, "Desktop control in APK");
  const native = await page.evaluate(async () => ({
    platform: await window.__TAURI_INTERNALS__.invoke("get_runtime_platform"),
    dataPath: await window.__TAURI_INTERNALS__.invoke("plugin:path|resolve_directory", { directory: 14 }),
    version: await window.__TAURI_INTERNALS__.invoke("plugin:app|version"),
    workDenied: await window.__TAURI_INTERNALS__.invoke("get_work_dashboard").then(() => false, () => true),
  }));
  check(native.platform === "android" && native.workDenied, "Native platform isolation failed");
  check(/^\/data\/(?:user\/0|data)\/com\.tideplan\.mobile\.uiuxqa(?:\/|$)/.test(native.dataPath) && native.version === "0.18.0", "Refusing daily or stale Android installation");
  check((await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_tasks"))).length === 0, "Needs empty synthetic QA data");
  await page.locator(".mobile-settings").click();
  const settings = page.getByRole("dialog", { name: "偏好设置", exact: true });
  await settings.locator(".ai-key-input input").fill("tideplan-local-test");
  await settings.getByRole("textbox", { name: "BASE_URL" }).fill("http://127.0.0.1:4319/v1");
  await settings.getByRole("button", { name: "保存 AI 配置", exact: true }).click();
  await page.getByText("AI 服务配置已保存", { exact: true }).waitFor();
  const connection = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("test_ai_connection"));
  check(connection.includes("连接成功"), "Native HTTP connection failed");
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await nav.getByRole("button", { name: "助手", exact: true }).click();
  await page.getByRole("textbox", { name: "给小汐的消息" }).fill("先验证升级与恢复，再发布；也想安排旅行，但目的还没想好。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByText("发布可以先从验证开始，我已把目标和第一步列好了。旅行先不急着安排：你更想放松休息，还是逛城市？", { exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "查看理解图", exact: true }).click();
  const map = page.getByRole("dialog", { name: "理解图", exact: true });
  check(await map.locator("input,textarea,select,[contenteditable=true]").count() === 0, "Understanding became editable");
  await map.getByRole("button", { name: "关闭理解图", exact: true }).click();
  await page.getByRole("button", { name: "打开交付清单", exact: true }).click();
  const delivery = page.getByRole("dialog", { name: "最终交付清单", exact: true });
  await delivery.getByRole("button", { name: "执行全部可执行项（2）", exact: true }).click();
  await delivery.getByText("已执行", { exact: false }).first().waitFor();
  const state = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_tasks"));
  check(state.length === 1 && state[0].title === "验证升级与恢复", "Native goal commit failed or created unclear task");
  await delivery.getByRole("button", { name: "关闭最终交付清单", exact: true }).click();
  await nav.getByRole("button", { name: "工具", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "计划日历", exact: true }).click();
  await page.locator('.calendar-controls').getByRole('button', { name: '今天', exact: true }).click();
  await page.locator('.day-agenda').getByText("验证升级与恢复", { exact: true }).first().waitFor();
  await nav.getByRole("button", { name: "工具", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "所有计划", exact: true }).click();
  await page.getByRole("button", { name: "验证升级与恢复的记事本", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Android 原生验证：记录已保存，下一步检查重启与备份。");
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await page.locator(".task-card .check-button").click();
  const completed = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_tasks"));
  check(completed.length === 1 && !!completed[0].completed_at && completed[0].notes.startsWith("Android 原生验证"), "Completion or notebook lost");
  await page.reload();
  const persisted = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_tasks"));
  check(JSON.stringify(persisted) === JSON.stringify(completed), "WebView reload changed native records");
  check(errors.length === 0, errors.join("\n"));
}
