// ONLY the isolated .syncqa app, after sync-native-smoke and peer conflict.
async (page) => {
  const sync = page.getByRole("region", {name:"跨设备同步",exact:true});
  await sync.getByRole("button", {name:"检查更改",exact:true}).click();
  await sync.getByRole("radio", {name:"保留本机版本",exact:true}).waitFor();
  const confirm = sync.getByRole("button", {name:"确认同步并重新载入",exact:true});
  if (!await confirm.isDisabled()) throw Error("Unresolved conflict can submit");
  await sync.getByText("手机冲突时的笔记",{exact:true}).waitFor();
  await sync.getByText("电脑同时修改的笔记",{exact:true}).waitFor();
  await sync.getByRole("radio", {name:"保留本机版本",exact:true}).check();
  await confirm.click();
  await page.getByRole("dialog",{name:"偏好设置",exact:true}).waitFor({state:"hidden"});
  const result = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const status = await invoke("get_sync_status");
    const backup = await invoke("export_sync_recovery");
    return {pending:status.pending, recovery:backup.syncRecoveryVersion,
      localNote:backup.local["task:11111111-1111-4111-8111-111111111111"].notes,
      remoteNote:backup.remote.records["task:11111111-1111-4111-8111-111111111111"].notes,
      containsToken:JSON.stringify(backup).includes("tideplan-local-test-token-not-for-production-123456")};
  });
  if (result.pending !== 0 || result.recovery !== 1 || result.containsToken ||
      result.localNote !== "手机冲突时的笔记" || result.remoteNote !== "电脑同时修改的笔记") {
    throw Error("Conflict recovery validation failed: " + JSON.stringify(result));
  }
  console.log("PASS: native conflict choice, clean baseline, both recovery versions without credentials");
}
