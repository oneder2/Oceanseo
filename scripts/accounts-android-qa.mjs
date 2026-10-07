// Real Pixel/.uiuxqa account switching; private HTTP fixture, never daily data.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

const execute = promisify(execFile);
const serial = process.argv[2];
const automatic = process.argv.includes("--automatic");
assert.ok(serial, "Supply an already connected/unlocked Android serial");
const pkg = "com.tideplan.mobile.uiuxqa";
const wrapper = "/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh";
const root = await mkdtemp("/tmp/oceanseo-accounts-android-");
const session = `accounts-android-${serial.replace(/[^a-zA-Z0-9-]/g, "")}`;
const forwardingPort = serial.startsWith("emulator-") ? 9265 : 9266;
const password = "Synthetic-Android-accounts-123!";
const adb = async (...args) => (await execute("adb", ["-s", serial, ...args], { timeout: 60000 })).stdout.trim();
const cli = async (...args) => (await execute("bash", [wrapper, `-s=${session}`, ...args], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const evaluate = async source => JSON.parse(await cli("eval", source, "--raw"));
const invoke = (name, args = {}) => evaluate(`async () => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`);
const ui = source => cli("run-code", `async (page) => { ${source} }`, "--raw");
async function wait(check, message, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw Error(message);
}
const pid = () => adb("shell", "pidof", pkg).catch(() => "");
async function attach(expectedKey) {
  const policy = await adb("shell", "dumpsys", "window", "policy");
  assert.ok(!/showing=true/.test(policy), "Android is locked; unlock before native UI testing");
  await cli("detach").catch(() => {});
  let current;
  await wait(async () => !!(current = await pid()), "Android main process did not start");
  assert.match(current, /^\d+$/);
  await adb("forward", `tcp:${forwardingPort}`, `localabstract:webview_devtools_remote_${current}`);
  await wait(async () => {
    try { return (await fetch(`http://127.0.0.1:${forwardingPort}/json/list`, { signal: AbortSignal.timeout(1500) })).ok; }
    catch { return false; }
  }, "Android WebView debugging not ready");
  await cli("attach", `--cdp=http://127.0.0.1:${forwardingPort}`);
  await cli("snapshot");
  let observed;
  try {
    await wait(async () => {
      try {
        const status = await invoke("get_profile_status");
        observed = { currentKey: status.current.key, selectedKey: status.selectedKey, restartRequired: status.restartRequired };
        return status.current.key === expectedKey;
      } catch (error) { observed = { error: String(error) }; return false; }
    }, "Android did not bind selected native profile");
  } catch (error) {
    console.error(JSON.stringify({ stage: "android-attach-failure", expectedKey, observed }));
    throw error;
  }
  assert.ok((await invoke("plugin:path|resolve_directory", { directory: 14 })).endsWith(`/${pkg}`));
  await ui("await page.locator('.mobile-settings').waitFor();");
  await wait(async () => (await invoke("get_mobile_reminder_status")).profileKey === expectedKey,
    "Android reminders are still bound to the previous profile");
}
const settings = () => ui("await page.locator('.mobile-settings').click(); await page.locator('.account-profile-picker,.account-form').first().waitFor();");
async function signIn(name, invite = null) {
  console.log(JSON.stringify({ stage: "android-account-auth", name, registration: !!invite }));
  await ui(`
    const accounts = page.getByRole('region', {name:'账号与资料库',exact:true});
    const details = accounts.locator('.account-auth');
    if (!(await details.evaluate(el=>el.open))) await details.locator('summary').click();
    await accounts.locator('.account-modes').getByRole('button',{name:${JSON.stringify(invite ? "邀请码注册" : "登录")},exact:true}).click();
    await accounts.getByLabel('账号服务地址',{exact:true}).fill(${JSON.stringify(endpoint)});
    await accounts.getByLabel('账号用户名',{exact:true}).fill(${JSON.stringify(name)});
    await accounts.getByLabel('账号密码',{exact:true}).fill(${JSON.stringify(password)});
    ${invite ? `await accounts.getByLabel('注册邀请码',{exact:true}).fill(${JSON.stringify(invite)});` : ""}
    await accounts.getByRole('button',{name:${JSON.stringify(invite ? "创建账号" : "登录账号")},exact:true}).click();
    await accounts.locator('.account-confirm').waitFor();
  `);
  const profiles = await invoke("list_local_profiles");
  const profile = profiles.find(p => p.username === name && p.endpoint === endpoint);
  assert.ok(profile);
  return profile;
}
const physicalDevice = !serial.startsWith("emulator-");
const evidence = { actualAndroid: true, actualHttp: true, physicalDevice, device: serial, package: pkg, root, gates: [] };
async function switchConfirmed(key) {
  console.log(JSON.stringify({ stage: "android-profile-restart", key }));
  const previous = await pid();
  await ui("await page.locator('.account-confirm').getByRole('button',{name:'确认切换',exact:true}).click();").catch(() => {});
  await wait(async () => { const next = await pid(); return next && next !== previous; }, "Android profile switch did not replace the Rust process");
  await attach(key);
  evidence.gates.push({ gate: "new-native-process-for-profile", oldPid: previous, newPid: await pid(), key });
}
async function task(title, note) {
  await ui(`
    await page.getByRole('button',{name:'添加计划',exact:true}).click();
    const editor=page.getByRole('dialog').filter({has:page.locator('input[maxlength="200"]')});
    await editor.locator('input[maxlength="200"]').fill(${JSON.stringify(title)});
    await editor.locator('textarea').fill(${JSON.stringify(note)});
    await editor.getByRole('button',{name:'保存计划',exact:true}).click();
    await editor.waitFor({state:'hidden'});
  `);
  const record = (await invoke("list_tasks")).find(task => task.title === title);
  assert.ok(record); return record;
}
const service = spawn("python3", ["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB']); print(json.dumps({'port':s.server_port,'alice':s.store.create_invite(),'bob':s.store.create_invite()}),flush=True); s.serve_forever()"], {
  env: { ...process.env, TEST_ACCOUNTS_DB: `${root}/accounts.sqlite3` }, stdio: ["ignore", "pipe", "pipe"],
});
async function automaticScenario(originalTask) {
  console.log(JSON.stringify({ stage: "android-automatic-sync", serial }));
  await settings();
  assert.equal((await invoke("get_automatic_sync_settings")).enabled, false);
  await ui("await page.getByRole('switch',{name:'本设备自动同步',exact:true}).click();");
  await wait(async () => (await invoke("get_automatic_sync_settings")).enabled, "Android auto opt-in failed");
  await ui("await page.getByRole('dialog',{name:'偏好设置',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();");
  const login = await fetch(`${endpoint}/v2/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "alice", password, deviceName: "Synthetic HTTP peer", platform: "linux" }),
  });
  assert.ok(login.ok); const peer = await login.json();
  const cloud = async body => {
    const response = await fetch(`${endpoint}/v2/vault`, { method: body ? "PUT" : "GET",
      headers: { "Authorization": `Bearer ${peer.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok, "Android fixture cloud request failed"); return response.json();
  };
  await evaluate("() => {window.__nativeAutoMarker='upload-without-reload';return true;}");
  const extra = await task("Android foreground auto-upload", "New record must upload without a manual check");
  await wait(async () => (await cloud()).records[`task:${extra.id}`]?.title === extra.title, "Android did not auto-upload", 45000);
  assert.equal(await evaluate("() => window.__nativeAutoMarker"), "upload-without-reload");
  await ui(`
    await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'工具',exact:true}).click();
    await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'所有计划',exact:true}).click();
    await page.getByRole('button',{name:${JSON.stringify(originalTask.title + "的记事本")},exact:true}).click();
  `);
  assert.equal(await evaluate("() => document.querySelector('#task-notebook').value"), "Alice unsaved notebook");
  const remote = await cloud();
  remote.records[`task:${originalTask.id}`].notes = "Synthetic peer note received automatically on Android";
  remote.records[`task:${originalTask.id}`].updated_at = new Date().toISOString();
  await cloud({ protocol: 1, vaultId: remote.vaultId, expectedRevision: remote.revision, records: remote.records });
  await evaluate("() => {window.dispatchEvent(new Event('online'));return true;}");
  await new Promise(resolve => setTimeout(resolve, 10000));
  assert.equal((await invoke("get_task", { id: originalTask.id })).notes, originalTask.notes);
  assert.equal(await evaluate("() => document.querySelector('#task-notebook').value"), "Alice unsaved notebook");
  await ui(`
    await page.locator('.notebook-backdrop').getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'工具',exact:true}).click();
    await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'计划日历',exact:true}).click();
  `);
  await wait(async () => (await invoke("get_task", { id: originalTask.id })).notes === remote.records[`task:${originalTask.id}`].notes,
    "Android did not receive cloud note after editor closed", 45000);
  await ui("await page.getByRole('heading',{name:'计划日历',exact:true}).waitFor();");
  assert.equal(await evaluate("() => window.__nativeAutoMarker ?? null"), null);
  evidence.gates.push({ gate: "android-foreground-automatic-sync", actualHttpPeer: true, actualNativeLinuxPeer: false,
    explicitOptIn: true, uploadWithoutReload: true, editingDefersDownload: true, calendarViewAfterReload: true, unsavedNotebookPreserved: true });
  return invoke("list_tasks");
}
let endpoint, setup, originalKey, originalTasks, originalAi;
try {
  setup = await new Promise((resolve, reject) => {
    let raw = ""; service.stdout.on("data", chunk => { raw += chunk; if (raw.includes("\n")) { try { resolve(JSON.parse(raw.split("\n")[0])); } catch (e) { reject(e); } } });
    service.once("error", reject); service.once("exit", () => reject(Error("Synthetic account server exited")));
  });
  endpoint = `http://127.0.0.1:${setup.port}`;
  await adb("reverse", `tcp:${setup.port}`, `tcp:${setup.port}`);
  await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`);
  // This harness requires the preserved local profile, not an arbitrary user's account.
  await attach("local"); originalKey = "local";
  originalTasks = await invoke("list_tasks"); originalAi = await invoke("get_ai_settings");
  await settings();
  const alice = await signIn("alice", setup.alice);
  assert.equal((await invoke("get_profile_status")).current.key, originalKey);
  assert.deepEqual(await invoke("list_tasks"), originalTasks);
  await switchConfirmed(alice.key);
  assert.deepEqual(await invoke("list_tasks"), []);
  const aliceTask = await task("Android Alice private record", "Only Alice may see this notebook");
  const aliceAi = await invoke("save_ai_settings", { apiKey: "synthetic-alice-key-12345", baseUrl: endpoint + "/v1", clearApiKey: false, model: "qa-alice" });
  const draftKey = `oceanseo.profile.v1:${alice.key}:tideplan.draft.notebook:${aliceTask.id}`;
  await evaluate(`() => {localStorage.setItem(${JSON.stringify(draftKey)},'Alice unsaved notebook'); return true;}`);
  await settings();
  await ui("await page.locator('.sync-settings').getByRole('button',{name:'检查更改',exact:true}).click(); await page.locator('.sync-settings').getByRole('button',{name:'确认同步并重新载入',exact:true}).click(); await page.getByRole('dialog',{name:'偏好设置',exact:true}).waitFor({state:'hidden'});");
  assert.equal((await invoke("get_sync_status")).pending, 0);
  const aliceTasks = automatic ? await automaticScenario(aliceTask) : [aliceTask];
  await settings();
  const bob = await signIn("bob", setup.bob);
  await switchConfirmed(bob.key);
  assert.deepEqual(await invoke("list_tasks"), []);
  assert.notEqual((await invoke("get_ai_settings")).model, aliceAi.model);
  const bobTask = await task("Android Bob private record", "Only Bob may see this notebook");
  const encrypted = await adb("shell", "run-as", pkg, "cat", `profiles/${bob.key}/account-session.json`);
  assert.ok(encrypted.startsWith("tideplan-keystore-v1:"), "Session not encrypted with Android Keystore");
  assert.ok(!encrypted.includes(password) && !encrypted.includes(endpoint), "Raw account fields leaked to disk");
  await invoke("delete_account", { password, confirmation: "DELETE" });
  assert.equal((await invoke("get_profile_status")).current.signedIn, false, "Account deletion did not clear local session");
  const deletedBob = await fetch(`${endpoint}/v2/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "bob", password, deviceName: "deleted Android", platform: "android" }) });
  assert.equal(deletedBob.status, 401, "Deleted account session remained valid");
  assert.deepEqual(await invoke("list_tasks"), [bobTask], "Account deletion removed the local offline copy");
  await settings(); await signIn("alice"); await switchConfirmed(alice.key);
  assert.deepEqual(await invoke("list_tasks"), aliceTasks);
  assert.deepEqual(await invoke("get_ai_settings"), aliceAi);
  assert.equal(await evaluate(`() => localStorage.getItem(${JSON.stringify(draftKey)})`), "Alice unsaved notebook");
  await settings();
  await ui("await page.locator('.account-settings').getByRole('button',{name:'刷新设备',exact:true}).click(); await page.locator('.account-device-icon').first().waitFor(); await page.locator('.account-settings').getByRole('button',{name:'撤销其他设备',exact:true}).click(); await page.locator('.account-confirm').getByRole('button',{name:'确认撤销',exact:true}).click();");
  await wait(async () => (await invoke("list_account_sessions")).sessions.length === 1, "Other Android sessions not revoked");
  await ui("await page.locator('.account-settings').getByRole('button',{name:'退出当前设备',exact:true}).click(); await page.locator('.account-confirm').getByRole('button',{name:'确认退出',exact:true}).click();");
  await wait(async () => !(await invoke("get_profile_status")).current.signedIn, "Android logout failed");
  assert.equal((await invoke("get_sync_status")).configured, false);
  assert.deepEqual(await invoke("list_tasks"), aliceTasks);
  await adb("shell", "am", "force-stop", pkg);
  await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`);
  await attach(alice.key);
  assert.equal((await invoke("get_profile_status")).current.signedIn, false);
  assert.deepEqual(await invoke("list_tasks"), aliceTasks);
  await settings();
  await ui("await page.getByLabel('切换资料库',{exact:true}).selectOption('local');");
  await switchConfirmed("local");
  assert.deepEqual(await invoke("list_tasks"), originalTasks);
  assert.deepEqual(await invoke("get_ai_settings"), originalAi);
  evidence.gates.push({ gate: "android-account-ui-storage-session-and-v2-sync", aliceId: aliceTask.id, bobId: bobTask.id,
    noImplicitImport: true, encryptedSession: true, aliceBobAlice: true, isolatedAiAndDrafts: true, reminderOwnerSwitched: true, revokeOthers: true, logoutOfflineColdStart: true, originalLocalPreserved: true, accountDeletionRevokesCloudSession: true, accountDeletionKeepsOfflineCopy: true });
  await mkdir("output/playwright", { recursive: true });
  await writeFile(`output/playwright/accounts-android-${physicalDevice ? "pixel" : "emulator"}${automatic ? "-automatic" : ""}-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, actualAndroid: true, actualHttp: true, gates: evidence.gates.length }));
} finally {
  // A failed QA stage must not leave the user's test installation stranded in
  // an account whose temporary server is about to stop. Keep its offline data.
  if (originalKey) {
    const policy = await adb("shell", "dumpsys", "window", "policy").catch(() => "showing=true");
    if (!/showing=true/.test(policy)) {
      try {
        const status = await invoke("get_profile_status");
        if (status.current.key !== originalKey || status.selectedKey !== originalKey) {
          await invoke("select_local_profile", { key: originalKey, expectedCurrent: status.current.key });
          await invoke("restart_selected_profile", { selectedKey: originalKey }).catch(() => {});
        }
      } catch { console.error("QA cleanup could not restore local selection; reopen QA and select 本机资料库."); }
    }
  }
  await cli("detach").catch(() => {});
  await adb("forward", "--remove", `tcp:${forwardingPort}`).catch(() => {});
  if (setup) await adb("reverse", "--remove", `tcp:${setup.port}`).catch(() => {});
  if (service.exitCode === null && service.signalCode === null) {
    service.kill("SIGTERM"); await new Promise(resolve => service.once("exit", resolve));
  }
}
