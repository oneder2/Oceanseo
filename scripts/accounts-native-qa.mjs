// Real Tauri, SQLite and HTTP in private temporary XDG directories. No daily data.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, writeFile, access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const execute = promisify(execFile);
const driverPath = process.argv[2];
const automatic = process.argv.includes("--automatic");
assert.ok(driverPath, "Supply an installed/extracted WebKitWebDriver path");
const root = await mkdtemp("/tmp/oceanseo-accounts-native-");
const binary = `${root}/app/tideplan`;
await mkdir(`${root}/app`); await copyFile("src-tauri/target/debug/tideplan", binary);
for (const name of ["data", "config", "cache"]) await mkdir(`${root}/${name}`, { mode: 0o700 });
const port = await new Promise(resolve => {
  const probe = net.createServer(); probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const driver = spawn(driverPath, [`--port=${port}`], { env: { ...process.env,
  XDG_DATA_HOME: `${root}/data`, XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`,
  TAURI_WEBVIEW_AUTOMATION: "true",
  // Deliberately inherit unrelated launcher metadata; never launch the real Paseo.
  APPIMAGE: "/usr/bin/false", APPDIR: `${root}/cache`,
}, stdio: ["ignore", "ignore", "pipe"] });
const service = spawn("python3", ["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB']); print(json.dumps({'port':s.server_port,'alice':s.store.create_invite(),'bob':s.store.create_invite()}),flush=True); s.serve_forever()"], {
  env: { ...process.env, TEST_ACCOUNTS_DB: `${root}/accounts.sqlite3` }, stdio: ["ignore", "pipe", "pipe"],
});
let session, setup;
const evidence = { actualNative: true, actualHttp: true, actualAndroid: false, unrelatedLauncherMetadata: true, root, gates: [] };
const elementKey = "element-6066-11e4-a52e-4f735466cecf";
const password = "Synthetic-account-native-123!";
const driverUrl = `http://127.0.0.1:${port}`;
async function wait(check, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 150)); }
  throw Error(message);
}
async function request(route, body, method = "POST") {
  const response = await fetch(driverUrl + route, { method, signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(response.ok && !result.value?.error, result.value?.error ?? "WebDriver request failed");
  return result.value;
}
const command = (route, body, method) => request(`/session/${session}${route}`, body, method);
const js = (script, ...args) => command("/execute/sync", { script, args });
async function invoke(name, args = {}) {
  const result = await command("/execute/async", { script: "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}))", args: [name, args] });
  assert.ok(!result.error, result.error); return result.value;
}
async function element(selector, text) {
  let result;
  await wait(async () => !!(result = await js("return [...document.querySelectorAll(arguments[0])].find(e=>e.getClientRects().length && (arguments[1]===null || e.textContent.trim()===arguments[1] || e.getAttribute('aria-label')===arguments[1])) || null", selector, text ?? null)), `Missing ${selector} ${text ?? ""}`);
  return result[elementKey];
}
async function click(selector, text) {
  await wait(() => js("return !document.querySelector('.sync-working')"), "Previous account/sync action has not finished");
  await command(`/element/${await element(selector, text)}/click`, {});
}
async function fill(selector, text) {
  const id = await element(selector);
  // WebKit's clear command can race React's controlled-value restoration.
  // Select and replace through real key events instead of mutating the DOM.
  await command(`/element/${id}/value`, { text: "\uE009a\uE000" });
  await command(`/element/${id}/value`, { text });
  await wait(() => js("return document.querySelector(arguments[0])?.value === arguments[1]", selector, text), "WebDriver input did not match the requested value");
}
async function ownPids() {
  try { const { stdout } = await execute("pgrep", ["-f", `^${binary}$`]); return stdout.trim().split(/\s+/).filter(Boolean).map(Number); }
  catch (e) { if (e.code === 1) return []; throw e; }
}
async function stopApp() {
  for (const pid of await ownPids()) { try { process.kill(pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  await wait(async () => !(await ownPids()).length, "Isolated app did not exit");
  if (session) { try { await request(`/session/${session}`, undefined, "DELETE"); } catch {} session = undefined; }
}
async function openApp(expectedKey) {
  console.log(JSON.stringify({ stage: "open-native-profile", expectedKey }));
  const result = await request("/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary } } } });
  session = result.sessionId;
  await command("/timeouts", { script: 60000, implicit: 0 });
  await wait(() => js("return !!document.querySelector('.account-settings') || document.querySelectorAll('button').length>10"), "Native app failed to mount");
  assert.equal(await invoke("plugin:path|resolve_directory", { directory: 14 }), `${root}/data/com.tideplan.desktop`);
  assert.equal((await invoke("get_profile_status")).current.key, expectedKey);
  await command("/window/rect", { width: 1180, height: 900 });
}
async function task(title, notes) {
  console.log(JSON.stringify({ stage: "create-synthetic-task", title }));
  await click("button", "添加计划");
  await fill("[role=dialog] input[maxlength='200']", title);
  await fill("[role=dialog] textarea", notes);
  await click("button", "保存计划");
  await wait(async () => (await invoke("list_tasks")).some(t => t.title === title), "Task not saved");
  return (await invoke("list_tasks")).find(t => t.title === title);
}
async function settings() { await click("button", "偏好设置"); }
async function signIn(name, register = false) {
  console.log(JSON.stringify({ stage: "native-account-sign-in", username: name, register }));
  if ((await invoke("get_profile_status")).current.signedIn) await click(".account-auth summary", "登录另一个账号");
  await click(".account-modes button", register ? "邀请码注册" : "登录");
  await fill("input[aria-label='账号服务地址']", `http://127.0.0.1:${setup.port}`);
  await fill("input[aria-label='账号用户名']", name);
  await fill("input[aria-label='账号密码']", password);
  if (register) await fill("input[aria-label='注册邀请码']", setup[name]);
  await click(".account-settings button", register ? "创建账号" : "登录账号");
  await wait(() => js("return !!document.querySelector('.account-confirm') || document.body.innerText.includes('已登录当前资料库')"), "Account sign in failed");
  const profiles = await invoke("list_local_profiles");
  const result = profiles.find(p => p.username === name && p.endpoint === `http://127.0.0.1:${setup.port}`);
  assert.ok(result, "Signed-in profile missing");
  return result;
}
async function confirmSwitch(key) {
  console.log(JSON.stringify({ stage: "confirm-native-profile-switch", key }));
  const previous = await ownPids(); assert.equal(previous.length, 1);
  // Clicking can race the old renderer's exit; the PID + persisted profile are authoritative.
  try { await click(".account-confirm button", "确认切换"); } catch {}
  await wait(async () => { const next = await ownPids(); return next.length === 1 && next[0] !== previous[0]; }, "Automatic native restart did not occur", 45000);
  const database = `${root}/data/com.tideplan.desktop/${key === "local" ? "" : `profiles/${key}/`}oceanseo-tasks.sqlite3`;
  await wait(async () => { try { await access(database); return true; } catch { return false; } }, "Restarted process did not open the selected database");
  evidence.gates.push({ gate: "automatic-linux-process-restart", key });
  await stopApp(); await openApp(key);
}
async function automaticScenario(originalTask) {
  console.log(JSON.stringify({ stage: "native-automatic-sync" }));
  await settings();
  assert.equal((await invoke("get_automatic_sync_settings")).enabled, false);
  await click("input[aria-label='本设备自动同步']");
  await wait(async () => (await invoke("get_automatic_sync_settings")).enabled, "Auto opt-in did not persist");
  await click("[aria-labelledby='settings-title'] button", "关闭");
  const login = await fetch(`http://127.0.0.1:${setup.port}/v2/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "alice", password, deviceName: "Synthetic HTTP peer", platform: "linux" }),
  });
  assert.ok(login.ok); const peer = await login.json();
  const cloud = async (body) => {
    const response = await fetch(`http://127.0.0.1:${setup.port}/v2/vault`, {
      method: body ? "PUT" : "GET", headers: { "Authorization": `Bearer ${peer.token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    });
    assert.ok(response.ok, "Temporary peer vault request failed"); return response.json();
  };
  await js("window.__nativeAutoMarker='upload-without-reload'; return true");
  const extra = await task("Native auto-upload task", "The foreground scheduler must upload without manual check");
  await wait(async () => (await cloud()).records[`task:${extra.id}`]?.title === extra.title, "Scheduler did not automatically upload", 45000);
  await wait(async () => !(await js("return !!document.querySelector('.sync-working')")), "Upload kept the UI frozen");
  assert.equal(await js("return window.__nativeAutoMarker"), "upload-without-reload");
  await click(".workspace-nav button", "所有计划");
  await click("button", `${originalTask.title}的记事本`);
  const unsaved = "Synthetic unsaved notebook must survive automatic downloads";
  await fill("#task-notebook", unsaved);
  const before = await cloud();
  before.records[`task:${originalTask.id}`].notes = "Synthetic remote note from same-account HTTP peer";
  before.records[`task:${originalTask.id}`].updated_at = new Date().toISOString();
  await cloud({ protocol: 1, vaultId: before.vaultId, expectedRevision: before.revision, records: before.records });
  await js("window.dispatchEvent(new Event('online')); return true");
  await new Promise(resolve => setTimeout(resolve, 10000));
  assert.equal((await invoke("get_task", { id: originalTask.id })).notes, originalTask.notes);
  assert.equal(await js("return document.querySelector('#task-notebook').value"), unsaved);
  await click(".notebook-backdrop button", "取消");
  await click(".workspace-nav button", "计划日历");
  await wait(async () => (await invoke("get_task", { id: originalTask.id })).notes === before.records[`task:${originalTask.id}`].notes,
    "Scheduler did not receive peer changes after editing ended", 45000);
  await wait(() => js("return document.querySelector('.workspace h1')?.textContent.trim()==='计划日历'"), "Automatic reload did not preserve calendar view");
  assert.equal(await js("return window.__nativeAutoMarker ?? null"), null);
  await click(".workspace-nav button", "所有计划");
  await click("button", `${originalTask.title}的记事本`);
  assert.equal(await js("return document.querySelector('#task-notebook').value"), unsaved);
  await click(".notebook-backdrop button", "取消");
  assert.equal((await invoke("get_sync_status")).pending, 0);
  evidence.gates.push({ gate: "real-native-automatic-sync", explicitOptIn: true, actualHttpPeer: true, actualAndroidPeer: false,
    uploadWithoutReload: true, editingDefersDownload: true, calendarViewAfterReload: true, unsavedNotebookPreserved: true });
  return invoke("list_tasks");
}
try {
  setup = await new Promise((resolve, reject) => {
    let raw = ""; service.stdout.on("data", chunk => { raw += chunk; if (raw.includes("\n")) { try { resolve(JSON.parse(raw.split("\n")[0])); } catch (e) { reject(e); } } });
    service.once("error", reject); service.once("exit", () => reject(Error("Synthetic account server exited")));
  });
  await wait(async () => { try { return (await fetch(driverUrl + "/status")).ok; } catch { return false; } }, "WebDriver not ready");
  await openApp("local");
  const original = await task("Native original offline record", "Never auto-import this into any account");
  await settings();
  const alice = await signIn("alice", true);
  assert.equal((await invoke("get_profile_status")).current.key, "local");
  assert.deepEqual(await invoke("list_tasks"), [original]);
  await confirmSwitch(alice.key);
  assert.deepEqual(await invoke("list_tasks"), []);
  const aliceTask = await task("Native Alice private task", "Alice's notebook only");
  await settings();
  await click(".sync-settings button", "检查更改");
  await click(".sync-settings button", "确认同步并重新载入");
  await wait(async () => (await invoke("get_sync_status")).linked, "Account v2 sync did not finish");
  assert.deepEqual(await invoke("list_tasks"), [aliceTask]);
  const aliceTasks = automatic ? await automaticScenario(aliceTask) : [aliceTask];
  await settings();
  const bob = await signIn("bob", true);
  await confirmSwitch(bob.key);
  assert.deepEqual(await invoke("list_tasks"), []);
  const bobTask = await task("Native Bob private task", "Bob's notebook only");
  await settings(); await signIn("alice"); await confirmSwitch(alice.key);
  assert.deepEqual(await invoke("list_tasks"), aliceTasks);
  await settings(); await click(".account-settings button", "刷新设备");
  const sessions = await invoke("list_account_sessions");
  assert.equal(sessions.sessions.filter(s => s.current).length, 1);
  await click(".account-settings button", "撤销其他设备"); await click(".account-confirm button", "确认撤销");
  await wait(async () => (await invoke("list_account_sessions")).sessions.length === 1, "Other sessions not revoked");
  await click(".account-settings button", "退出当前设备"); await click(".account-confirm button", "确认退出");
  await wait(async () => !(await invoke("get_profile_status")).current.signedIn, "Logout failed");
  assert.equal((await invoke("get_sync_status")).configured, false);
  assert.deepEqual(await invoke("list_tasks"), aliceTasks);
  await stopApp(); await openApp(alice.key);
  assert.equal((await invoke("get_profile_status")).current.signedIn, false);
  assert.deepEqual(await invoke("list_tasks"), aliceTasks);
  await settings();
  // Returning to local mode exercises the same explicit confirmation and restart.
  await element('[aria-label="切换资料库"]');
  await js("const s=document.querySelector('[aria-label=\"切换资料库\"]'); s.value='local'; s.dispatchEvent(new Event('change',{bubbles:true})); return true");
  await confirmSwitch("local");
  assert.deepEqual(await invoke("list_tasks"), [original]);
  evidence.gates.push({ gate: "native-ui-accounts-isolation-and-manual-v2-sync", originalId: original.id, aliceId: aliceTask.id, bobId: bobTask.id,
    invitedRegistration: true, noImplicitImport: true, aliceToBobToAlice: true, revokeOthers: true, logoutOfflineRestart: true, returnLocal: true });
  await mkdir("output/playwright", { recursive: true });
  await writeFile(`output/playwright/accounts-native${automatic ? "-automatic" : ""}-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, root, gates: evidence.gates.length, actualNative: true, actualHttp: true }));
} catch (error) {
  await mkdir("output/playwright", { recursive: true });
  if (session) {
    const screenshot = await command("/screenshot", undefined, "GET").catch(() => null);
    if (screenshot) await writeFile("output/playwright/accounts-native-failure.png", Buffer.from(screenshot, "base64"));
    await writeFile("output/playwright/accounts-native-failure.json", JSON.stringify({ ...evidence, error: String(error) }, null, 2));
  }
  throw error;
} finally {
  await stopApp().catch(() => {});
  for (const child of [service, driver]) {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  }
}
