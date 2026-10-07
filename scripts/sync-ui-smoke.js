// Isolated browser UI fixture only; native/network behavior is tested separately.
// Run after mobile-ui-smoke.js, which establishes the mobile shell.
async (page) => {
  const check = (v, message) => { if (!v) throw Error(message); };
  await page.evaluate(() => {
    window.isTauri = true;
    window.__syncCalls = [];
    window.__syncFixture = { endpoint: "", configured: false, pending: 2, lastSuccess: null, revision: 0, linked: false, recoveryAvailable: false };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.__syncCalls.push({ command, args });
      if (command === "get_profile_status") return { current: { key: "local", username: null, endpoint: null, sessionId: null, expiresAt: null, signedIn: false, active: true }, selectedKey: "local", restartRequired: false };
      if (command === "list_local_profiles") return [{ key: "local", username: null, endpoint: null, sessionId: null, expiresAt: null, signedIn: false, active: true }];
      if (command === "get_sync_status") return { ...window.__syncFixture };
      if (command === "get_map_settings") return { configured: false, keyHint: null };
      if (command === "save_sync_config") { Object.assign(window.__syncFixture, { endpoint: args.endpoint, configured: true }); return; }
      if (command === "preview_sync") return {
        previewId: "fixture-preview", uploadCount: 1, downloadCount: 1, firstConnection: true,
        changes: [{key:"task:deleted",title:"旧任务：检查删除预览",upload:false,download:true,deleted:true}],
        conflicts: [{ key: "task:fixture", local: { title: "电脑整理的计划", notes: "电脑上保存的笔记", horizon: "short", priority: "normal", due_date: "2026-10-05" }, remote: { title: "手机整理的计划", notes: "手机上保存的笔记", horizon: "short", priority: "important", due_date: "2026-10-08" } }],
      };
      if (command === "commit_sync") {
        await new Promise(resolve => setTimeout(resolve, 1200));
        throw "另一台设备刚刚更新了资料，请重新检查更改后同步。";
      }
      if (command === "disconnect_sync") { window.__syncFixture.configured = false; window.__syncFixture.endpoint = ""; return; }
      if (command === "set_app_state") return;
      throw Error(`Fixture does not implement ${command}`);
    } };
  });
  await page.locator(".mobile-settings").click();
  const panel = page.getByRole("region", { name: "跨设备同步", exact: true });
  await panel.getByRole("textbox", { name: "同步服务地址" }).fill("https://sync.example.test");
  await panel.getByLabel("同步访问令牌", { exact: true }).fill("tideplan-local-test-token-not-for-production-123456");
  check(await panel.getByRole("button", { name: "检查更改", exact: true }).isDisabled(), "Unsaved config should not connect");
  await panel.getByRole("button", { name: "保存同步配置" }).click();
  await panel.getByRole("button", { name: "检查更改", exact: true }).click();
  const confirm = panel.getByRole("button", { name: "确认同步并重新载入" });
  await confirm.waitFor();
  check(await confirm.isDisabled(), "Unresolved conflict should block commit");
  await panel.getByText("旧任务：检查删除预览", { exact: true }).waitFor();
  for (const width of [320, 390, 960]) {
    await page.setViewportSize({ width, height: 844 });
    await panel.locator(".sync-conflict").scrollIntoViewIfNeeded();
    check(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), `Sync panel overflow ${width}`);
    await page.screenshot({path:`output/playwright/sync-conflict-${width}.png`});
  }
  await panel.getByRole("radio", { name: "保留本机版本", exact: true }).check();
  check(await confirm.isEnabled(), "Resolved conflict did not enable commit");
  await confirm.click();
  await page.getByRole("dialog", { name: "正在处理同步", exact: true }).waitFor();
  check(await page.evaluate(() => window.__tideplanBack()), "Back must be consumed during sync");
  await page.getByText("另一台设备刚刚更新了资料，请重新检查更改后同步。", { exact: true }).waitFor();
  check(await confirm.count() === 0, "Stale preview should be discarded");
  check(await panel.getByRole("button", {name:"检查更改",exact:true}).isEnabled(), "Failed commit must allow retry");
  await panel.getByRole("button", {name:"断开连接",exact:true}).click();
  await panel.getByText("尚未连接同步服务", {exact:true}).waitFor();
  check(await panel.getByRole("button", {name:"检查更改",exact:true}).isDisabled(), "Disconnect should disable network sync");
  check(await page.evaluate(() => window.__syncCalls.filter(c => c.command === "commit_sync").length) === 1, "Repeated commit");
}
