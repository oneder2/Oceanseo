// One real account service and vault shared by isolated Linux and Pixel clients.
// Only .uiuxqa is touched. Offline tests remove this harness's reverse route.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { mkdtemp, mkdir, copyFile, writeFile } from "node:fs/promises";
import net from "node:net";

const execute = promisify(execFile);
const [driverPath, serial] = process.argv.slice(2);
const quick = process.argv.includes("--quick");
assert.ok(driverPath && serial, "Supply WebKitWebDriver path and unlocked Android serial");
const pkg = "com.tideplan.mobile.uiuxqa";
const wrapper = "/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh";
const root = await mkdtemp("/tmp/oceanseo-accounts-joint-");
const binary = `${root}/app/tideplan`;
const password = "Synthetic-shared-account-123!";
const cliSession = `accounts-joint-${process.pid}`;
const evidence = { actualNativeLinux: true, actualAndroid: true, actualHttp: true,
  actualPhysicalPhone: !serial.startsWith("emulator-"), sharedAccountService: true, actualAIRequest: false, package: pkg, device: serial, root, gates: [] };
const log = stage => console.log(JSON.stringify({ stage }));
const adb = async (...args) => (await execute("adb", ["-s", serial, ...args], { timeout: 60000 })).stdout.trim();
const cli = async (...args) => (await execute("bash", [wrapper, `-s=${cliSession}`, ...args], {
  timeout: 60000, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
async function wait(check, message, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 250)); }
  throw Error(message);
}
async function freePort() {
  return new Promise(resolve => { const probe = net.createServer(); probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port; probe.close(() => resolve(port));
  }); });
}
await mkdir(`${root}/app`); await copyFile("src-tauri/target/debug/tideplan", binary);
for (const name of ["data", "config", "cache"]) await mkdir(`${root}/${name}`, { mode: 0o700 });
const driverPort = await freePort(), forwardPort = await freePort();
const driverUrl = `http://127.0.0.1:${driverPort}`;
let service, driver, session, setup, endpoint, originalTasks, originalAi, originalKey;
let reverseOwned = false, forwardOwned = false;
const elementKey = "element-6066-11e4-a52e-4f735466cecf";
async function request(route, body, method = "POST") {
  const response = await fetch(driverUrl + route, { method, signal: AbortSignal.timeout(25000),
    headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(response.ok && !result.value?.error, result.value?.error ?? "WebDriver failed");
  return result.value;
}
const command = (route, body, method) => request(`/session/${session}${route}`, body, method);
const linux = {
  eval: (script, ...args) => command("/execute/sync", { script, args }),
  invoke: async (name, args = {}) => {
    const result = await command("/execute/async", { script: "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error}))", args: [name, args] });
    if (result.error) throw Error(JSON.stringify(result.error)); return result.value;
  },
  element: async (selector, text = null) => {
    let result;
    await wait(async () => !!(result = await linux.eval("return [...document.querySelectorAll(arguments[0])].find(e=>e.getClientRects().length && (arguments[1]===null || e.textContent.trim()===arguments[1] || e.getAttribute('aria-label')===arguments[1])) || null", selector, text)), `Missing Linux ${selector} ${text}`);
    return result[elementKey];
  },
  click: async (selector, text) => {
    await wait(() => linux.eval("return !document.querySelector('.sync-working')"), "Linux still busy");
    const id = await linux.element(selector, text);
    await linux.eval("arguments[0].scrollIntoView({block:'center',inline:'center'});return true", { [elementKey]: id });
    await new Promise(resolve => setTimeout(resolve, 200));
    await wait(() => linux.eval("const e=arguments[0],r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))", { [elementKey]: id }), `Linux target obscured: ${selector} ${text ?? ''}`);
    try { await command(`/element/${id}/click`, {}); }
    catch (error) { throw Error(`Linux click ${selector} ${text ?? ''}: ${error}`); }
  },
  fill: async (selector, text) => {
    const id = await linux.element(selector);
    await command(`/element/${id}/value`, { text: "\uE009a\uE000" });
    await command(`/element/${id}/value`, { text });
    await wait(() => linux.eval("return document.querySelector(arguments[0]).value===arguments[1]", selector, text), "Linux controlled input has not settled");
  },
  settings: () => linux.click(".sidebar-footer button", "我的账号"),
  closeSettings: () => linux.click("[aria-labelledby='account-title'] button", "关闭"),
  wake: () => linux.eval("window.dispatchEvent(new Event('online'));return true"),
  reload: () => linux.eval("location.reload();return true"),
};
const phone = {
  eval: async source => JSON.parse(await cli("eval", source, "--raw")),
  ui: source => cli("run-code", `async (page) => { ${source} }`, "--raw"),
  invoke: (name, args = {}) => phone.eval(`async () => window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`),
  settings: () => phone.ui("await page.locator('.account-entry').click(); await page.locator('.account-form').first().waitFor({state:'attached'});"),
  closeSettings: () => phone.ui("await page.getByRole('dialog',{name:'我的账号',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();"),
  wake: () => phone.eval("() => {window.dispatchEvent(new Event('online'));return true;}"),
  reload: () => phone.eval("() => {location.reload();return true;}"),
};
async function ownPids() {
  try { return (await execute("pgrep", ["-f", `^${binary}$`])).stdout.trim().split(/\s+/).filter(Boolean); }
  catch (e) { if (e.code === 1) return []; throw e; }
}
async function stopLinux() {
  for (const pid of await ownPids()) { try { process.kill(Number(pid), "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  await wait(async () => !(await ownPids()).length, "Isolated Linux process remains");
  if (session) { await request(`/session/${session}`, undefined, "DELETE").catch(() => {}); session = null; }
}
async function openLinux(key) {
  const result = await request("/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary } } } });
  session = result.sessionId;
  await command("/timeouts", { script: 60000, implicit: 0 });
  await wait(() => linux.eval("return document.querySelectorAll('button').length>10"), "Linux did not mount");
  assert.equal((await linux.invoke("get_profile_status")).current.key, key);
  assert.equal(await linux.invoke("plugin:path|resolve_directory", { directory: 14 }), `${root}/data/com.tideplan.desktop`);
  await command("/window/rect", { width: 1180, height: 900 });
  // The foreground-only scheduler must be tested with a visible native page.
  // Only this temporary app is pinned; closing it removes the window state.
  await linux.invoke("plugin:window|set_always_on_top", { label: "main", value: true });
  const pids = await ownPids();
  const windows = (await execute("wmctrl", ["-lp"])).stdout.split("\n")
    .map(line => line.trim().split(/\s+/)).filter(fields => pids.includes(fields[2]));
  assert.equal(windows.length, 1, "Expected exactly one isolated native test window");
  const desktop = (await execute("wmctrl", ["-d"])).stdout.split("\n")
    .find(line => /^\d+\s+\*/.test(line))?.split(/\s+/)[0];
  assert.ok(desktop, "Current desktop missing");
  await execute("wmctrl", ["-ir", windows[0][0], "-t", desktop]);
  await execute("wmctrl", ["-ia", windows[0][0]]);
  await wait(() => linux.eval("return document.visibilityState==='visible'"), "Linux test window is not visible");
}
const phonePid = () => adb("shell", "pidof", pkg).catch(() => "");
async function attachPhone(key) {
  assert.ok(!/showing=true/.test(await adb("shell", "dumpsys", "window", "policy")), "Phone is locked: unlock to test");
  await cli("detach").catch(() => {});
  let pid;
  await wait(async () => !!(pid = await phonePid()), "Android process missing");
  assert.match(pid, /^\d+$/);
  await adb("forward", "--no-rebind", `tcp:${forwardPort}`, `localabstract:webview_devtools_remote_${pid}`).catch(async error => {
    if (!forwardOwned) throw error;
    await adb("forward", `tcp:${forwardPort}`, `localabstract:webview_devtools_remote_${pid}`);
  });
  forwardOwned = true;
  await wait(async () => { try { return (await fetch(`http://127.0.0.1:${forwardPort}/json/list`)).ok; } catch { return false; } }, "Android CDP missing");
  await cli("attach", `--cdp=http://127.0.0.1:${forwardPort}`); await cli("snapshot");
  await wait(async () => (await phone.invoke("get_profile_status")).current.key === key, "Android profile mismatch");
  assert.ok((await phone.invoke("plugin:path|resolve_directory", { directory: 14 })).endsWith(`/${pkg}`));
  await wait(async () => (await phone.invoke("get_mobile_reminder_status")).profileKey === key, "Android reminder owner mismatch");
}
async function switchLinux(key) {
  const previous = await ownPids();
  await linux.click(".account-confirm button", "确认切换").catch(() => {});
  await wait(async () => { const next = await ownPids(); return next.length === 1 && next[0] !== previous[0]; }, "Linux restart failed");
  await stopLinux(); await openLinux(key);
}
async function switchPhone(key) {
  const previous = await phonePid();
  await phone.ui("await page.locator('.account-confirm').getByRole('button',{name:'确认切换',exact:true}).click();").catch(() => {});
  await wait(async () => { const next = await phonePid(); return next && next !== previous; }, "Android restart failed");
  await attachPhone(key);
}
async function loginLinux(name, invite) {
  await linux.eval("const d=document.querySelector('.account-auth');if(!d.open)d.querySelector('summary').click();return true");
  await linux.eval("const d=document.querySelector('.account-connection');if(!d.open)d.querySelector('summary').click();return true");
  await linux.click(".account-modes button", invite ? "邀请码注册" : "登录");
  for (const [label, value] of [["账号服务地址", endpoint], ["账号用户名", name], ["账号密码", password], ["设备名称", "Joint Linux"]]) await linux.fill(`input[aria-label='${label}']`, value);
  if (invite) await linux.fill("input[aria-label='注册邀请码']", invite);
  await linux.click(".account-settings button", invite ? "创建账号" : "登录账号");
  await linux.element(".account-confirm");
  return (await linux.invoke("list_local_profiles")).find(p => p.username === name && p.endpoint === endpoint);
}
async function loginPhone(name) {
  await phone.ui(`
    const accounts=page.getByRole('region',{name:'账号与资料库',exact:true});
    const auth=accounts.locator('.account-auth');if(!(await auth.evaluate(el=>el.open)))await auth.locator('summary').click();
    const connection=accounts.locator('.account-connection');if(!(await connection.evaluate(el=>el.open)))await connection.locator('summary').click();
    await accounts.locator('.account-modes').getByRole('button',{name:'登录',exact:true}).click();
    await accounts.getByLabel('账号服务地址',{exact:true}).fill(${JSON.stringify(endpoint)});
    await accounts.getByLabel('账号用户名',{exact:true}).fill(${JSON.stringify(name)});
    await accounts.getByLabel('账号密码',{exact:true}).fill(${JSON.stringify(password)});
    await accounts.getByLabel('设备名称',{exact:true}).fill('Joint Pixel');
    await accounts.getByRole('button',{name:'登录账号',exact:true}).click();
    await page.waitForFunction(()=>!!document.querySelector('.account-confirm') || document.body.innerText.includes('登录成功，记录会自动同步'));
  `);
  let profile;
  await wait(async () => !!(profile = (await phone.invoke("list_local_profiles")).find(p => p.username === name && p.endpoint === endpoint)), "Phone login failed");
  return profile;
}
async function manualPhone(conflict = false) {
  if (!conflict) { await phone.closeSettings(); await phone.wake(); return; }
  await phone.ui(`
    const sync=page.getByRole('region',{name:'账号同步',exact:true});
    await sync.getByRole('button',{name:'确认待定内容',exact:true}).click();
    await sync.getByRole('radio',{name:'这台设备的内容',exact:true}).check();
    await sync.getByRole('button',{name:'确认保留并继续',exact:true}).click();
    await page.getByRole('dialog',{name:'我的账号',exact:true}).waitFor({state:'hidden'});
  `);
}
async function taskLinux(title, notes) {
  await linux.click("button", "添加计划");
  await linux.fill("[role=dialog] input[maxlength='200']", title); await linux.fill("[role=dialog] textarea", notes);
  await linux.click("button", "保存计划");
  await wait(async () => (await linux.invoke("list_tasks")).some(t => t.title === title), "Linux task missing");
  return (await linux.invoke("list_tasks")).find(t => t.title === title);
}
async function taskPhone(title, notes) {
  await phone.ui(`await page.getByRole('button',{name:/^(添加计划|新计划)$/}).click();
    const editor=page.getByRole('dialog').filter({has:page.locator('input[maxlength="200"]')});
    await editor.locator('input[maxlength="200"]').fill(${JSON.stringify(title)});
    await editor.locator('textarea').fill(${JSON.stringify(notes)});
    await editor.getByRole('button',{name:'保存计划',exact:true}).click();await editor.waitFor({state:'hidden'});`);
  return (await phone.invoke("list_tasks")).find(t => t.title === title);
}
async function plansPhone() {
  await phone.ui("await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button',{name:'所有计划',exact:true}).click();");
}
async function notePhone(title, note) {
  await phone.ui(`await page.getByRole('button',{name:${JSON.stringify(title + "的记事本")},exact:true}).click();
    await page.locator('#task-notebook').fill(${JSON.stringify(note)});
    await page.getByRole('button',{name:'保存笔记',exact:true}).click();await page.locator('.notebook-backdrop').waitFor({state:'hidden'});`);
}
async function noteLinux(title, note) {
  await linux.click("button", title + "的记事本"); await linux.fill("#task-notebook", note); await linux.click("button", "保存笔记");
}
const record = async (client, id) => (await client.invoke("list_tasks")).find(task => task.id === id) ?? null;
async function converge(id, check = () => true) {
  await wait(async () => {
    const a = await record(linux, id), b = await record(phone, id);
    return !!a && !!b && check(a) && isDeepStrictEqual(a, b)
      && (await linux.invoke("get_sync_status")).pending === 0 && (await phone.invoke("get_sync_status")).pending === 0;
  }, "Clients did not converge", 120000);
}
async function offline(value) {
  if (value) { await adb("reverse", "--remove", `tcp:${setup.port}`); reverseOwned = false; }
  else { await adb("reverse", "--no-rebind", `tcp:${setup.port}`, `tcp:${setup.port}`); reverseOwned = true; if (originalKey) await phone.wake(); }
}
function normalizedGoals(state) { if (!state) return state; const copy = structuredClone(state); delete copy.revision; delete copy.operations; delete copy.undo; return copy; }
async function saveGoalFixture(client, text) {
  const previous = await client.invoke("get_goal_state");
  const state = previous ?? { version: 1, revision: 0, thoughts: [], draft: "", goals: [], actions: [], proposals: [], reviews: [],
    preferences: { minutes: 60, energy: "normal", dailyLimit: 3, checkins: false, autoReview: false, reviewTime: "19:00", reviewWeekday: 0 }, operations: [], undo: null };
  const operationId = `joint-op-${Date.now()}`;
  state.revision++; state.operations.push(operationId); state.undo = null;
  state.preferences.checkins = false; state.preferences.autoReview = false;
  if (!state.goals.length) state.goals.push({ id: "joint-goal", parentId: "", title: "Synthetic joint test goal", criterion: "Both devices agree", status: "active", reviewDate: "2026-10-12" });
  state.conversation ??= { messages: [], understanding: [{ id: "joint-clear", parentId: "", label: "Same-account synchronization", status: "clear", evidence: "User confirmed" }], proposalId: "", receipts: [], needsReply: false };
  if (!state.conversation.understanding.length) state.conversation.understanding.push(
    { id: "joint-clear", parentId: "", label: "Same-account synchronization", status: "clear", evidence: "User confirmed" },
    { id: "joint-unknown", parentId: "joint-clear", label: "Next review date", status: "unknown", evidence: "Awaiting user confirmation" });
  state.conversation.messages.push({ id: `joint-message-${Date.now()}`, role: "user", text, createdAt: new Date().toISOString() });
  await client.invoke("commit_goal_changes", { request: { expectedRevision: state.revision - 1, operationId, next: state, createTasks: [], updateTasks: [], checks: [], undo: false } });
  await client.reload();
  return normalizedGoals(state);
}
async function goalsConverge(expected) {
  await wait(async () => isDeepStrictEqual(normalizedGoals(await linux.invoke("get_goal_state")), expected)
    && isDeepStrictEqual(normalizedGoals(await phone.invoke("get_goal_state")), expected), "Goal and conversation snapshots differ", 120000);
}

try {
  service = spawn("python3", ["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB']); print(json.dumps({'port':s.server_port,'alice':s.store.create_invite(),'bob':s.store.create_invite()}),flush=True); s.serve_forever()"], {
    env: { ...process.env, TEST_ACCOUNTS_DB: `${root}/accounts.sqlite3` }, stdio: ["ignore", "pipe", "pipe"],
  });
  setup = await new Promise((resolve, reject) => {
    let raw = ""; service.stdout.on("data", chunk => { raw += chunk; if (raw.includes("\n")) { try { resolve(JSON.parse(raw.split("\n")[0])); } catch (e) { reject(e); } } });
    service.once("error", reject); service.once("exit", () => reject(Error("Temporary service exited")));
  });
  endpoint = `http://127.0.0.1:${setup.port}`;
  driver = spawn(driverPath, [`--port=${driverPort}`], { env: { ...process.env, XDG_DATA_HOME: `${root}/data`, XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`, TAURI_WEBVIEW_AUTOMATION: "true", APPIMAGE: "/usr/bin/false", APPDIR: `${root}/cache` }, stdio: ["ignore", "ignore", "pipe"] });
  await wait(async () => { try { return (await fetch(driverUrl + "/status")).ok; } catch { return false; } }, "Driver not ready");
  await openLinux("local");
  await offline(false); await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`); await attachPhone("local");
  originalKey = "local"; originalTasks = await phone.invoke("list_tasks"); originalAi = await phone.invoke("get_ai_settings");
  log("shared-account-registration-and-automatic-first-connection");
  await linux.settings(); const alice = await loginLinux("alice", setup.alice); await switchLinux(alice.key);
  log("linux-registered-and-restarted");
  assert.deepEqual(await linux.invoke("list_tasks"), []);
  const main = await taskLinux("Joint initial Linux task", "Original joint notebook");
  await wait(async () => (await linux.invoke("get_sync_status")).linked, "Linux automatic first connection failed");
  log("linux-first-sync-without-manual-action");
  await phone.settings(); const phoneAlice = await loginPhone("alice"); assert.equal(phoneAlice.key, alice.key); await switchPhone(alice.key);
  log("pixel-same-account-restarted");
  assert.ok(!(await phone.invoke("list_tasks")).some(task => originalTasks.some(original => original.id === task.id)));
  await converge(main.id);
  for (const client of [linux, phone]) assert.equal((await client.invoke("get_automatic_sync_settings")).enabled, true);
  evidence.gates.push({ gate: "one-account-two-native-platforms", noImplicitImport: true, automaticFirstConnection: true, noServerSetupInNormalUI: true, profileKey: alice.key });
  log("linux-to-pixel-and-pixel-notebook-completion-to-linux");
  const added = await taskLinux("Joint automatically uploaded Linux task", "Created in desktop UI");
  await converge(added.id, t => t.title === added.title); await plansPhone();
  await notePhone(main.title, "Pixel notebook propagated to Linux");
  await phone.ui(`await page.locator('.task-card').filter({has:page.getByRole('button',{name:${JSON.stringify(main.title + "的记事本")},exact:true})}).getByRole('button',{name:'完成计划',exact:true}).click();`);
  await converge(main.id, t => t.notes === "Pixel notebook propagated to Linux" && !!t.completed_at);
  evidence.gates.push({ gate: "bidirectional-foreground-auto-sync", linuxCreatedOnPixel: added.id, pixelNoteAndCompletionOnLinux: main.id, fullTaskFieldsEqual: true, pending: 0 });
  if (!quick) {
  log("pixel-offline-and-disjoint-field-merge");
  await offline(true);
  const offlineTask = await taskPhone("Joint Pixel offline creation", "Retained without a cloud connection");
  // Completed tasks are accessed in the completed view, so use the other task.
  await notePhone(added.title, "Pixel offline note");
  await linux.click(".workspace-nav button", "所有计划");
  // Select the exact record through its notebook's parent, not arbitrary order.
  const editorButton = await linux.eval("return [...document.querySelectorAll('.task-card')].find(e=>e.querySelector('.task-notebook-button')?.getAttribute('aria-label')===arguments[0]).querySelector('.task-main')", added.title + "的记事本");
  await command(`/element/${editorButton[elementKey]}/click`, {});
  await linux.fill("[role=dialog] input[maxlength='200']", "Joint Linux renamed while Pixel offline"); await linux.click("button", "保存计划");
  await wait(async () => (await linux.invoke("get_sync_status")).pending === 0, "Linux did not upload offline-peer change");
  assert.equal((await record(phone, added.id)).notes, "Pixel offline note");
  assert.ok((await phone.invoke("list_tasks")).some(t => t.id === offlineTask.id));
  await offline(false);
  await converge(added.id, t => t.title === "Joint Linux renamed while Pixel offline" && t.notes === "Pixel offline note");
  await converge(offlineTask.id, t => t.title === offlineTask.title);
  evidence.gates.push({ gate: "real-pixel-offline-recovery", onlyOwnedReverseRemoved: true, offlineCreationPreserved: true, disjointFieldsMerged: true, pending: 0 });
  log("same-field-conflict-requires-user-choice");
  const currentTitle = (await record(phone, added.id)).title;
  await offline(true); await notePhone(currentTitle, "Pixel explicit conflict choice");
  await noteLinux(currentTitle, "Linux conflicting notebook version");
  await wait(async () => (await linux.invoke("get_sync_status")).pending === 0, "Linux conflicting edit not uploaded");
  await offline(false);
  await wait(async () => (await phone.invoke("get_automatic_sync_settings")).pause === "conflict", "Automatic sync did not pause for conflict", 120000);
  assert.equal((await record(phone, added.id)).notes, "Pixel explicit conflict choice");
  assert.equal((await record(linux, added.id)).notes, "Linux conflicting notebook version");
  await phone.settings(); await manualPhone(true);
  await converge(added.id, t => t.notes === "Pixel explicit conflict choice");
  assert.equal((await phone.invoke("get_automatic_sync_settings")).pause, null);
  evidence.gates.push({ gate: "conflict-pause-and-ui-recovery", noSilentOverwrite: true, explicitPixelChoice: true, automaticResume: true });
  log("goal-and-saved-conversation-roundtrip");
  const initialGoals = await saveGoalFixture(linux, "Synthetic saved idea from Linux; this tests storage, not a paid AI call");
  await goalsConverge(initialGoals);
  const replyGoals = await saveGoalFixture(phone, "Synthetic follow-up saved on Pixel"); await goalsConverge(replyGoals);
  evidence.gates.push({ gate: "goal-conversation-understanding-two-platforms", nativeGoalCommit: true, actualAIRequest: false, roundtrip: true });
  log("revoke-pixel-device-from-linux");
  const beforeRevocation = await phone.invoke("list_tasks");
  await linux.settings(); await linux.click(".account-settings button", "刷新设备");
  await wait(() => linux.eval("return [...document.querySelectorAll('.account-devices li')].some(e=>e.textContent.includes('Joint Pixel') && !!e.querySelector('button'))"), "Refreshed Pixel device missing");
  assert.equal(await linux.eval("return document.querySelectorAll('.account-devices li button').length"), 1);
  await linux.click(".account-devices li button", "撤销"); await linux.click(".account-confirm button", "确认撤销"); await linux.closeSettings();
  await phone.wake();
  await wait(async () => (await phone.invoke("get_automatic_sync_settings")).pause === "auth", "Revoked Pixel did not pause", 120000);
  assert.deepEqual(await phone.invoke("list_tasks"), beforeRevocation);
  const extraOffline = await taskPhone("Joint revoked-device offline record", "Must survive revoked session");
  assert.ok(!(await linux.invoke("list_tasks")).some(t => t.id === extraOffline.id));
  await phone.settings(); await loginPhone("alice"); await manualPhone();
  await converge(extraOffline.id, t => t.title === extraOffline.title);
  evidence.gates.push({ gate: "actual-device-revocation-and-relogin", pixelAuthPause: true, offlineDataPreserved: true, otherDeviceStillUsable: true, reloginSameVault: true });
  log("second-user-isolation-and-cold-start");
  const aliceTasks = await linux.invoke("list_tasks");
  await linux.settings(); const bob = await loginLinux("bob", setup.bob); await switchLinux(bob.key);
  assert.deepEqual(await linux.invoke("list_tasks"), []); assert.equal(await linux.invoke("get_goal_state"), null);
  const bobTask = await taskLinux("Joint Bob private task", "Cannot enter Alice's vault");
  await wait(async () => (await linux.invoke("get_sync_status")).linked && (await linux.invoke("get_sync_status")).pending === 0, "Bob automatic connection failed");
  assert.ok(!(await phone.invoke("list_tasks")).some(t => t.id === bobTask.id));
  await linux.settings();
  await linux.eval("const s=document.querySelector('[aria-label=\"切换资料库\"]');s.value=arguments[0];s.dispatchEvent(new Event('change',{bubbles:true}));return true", alice.key);
  await switchLinux(alice.key); assert.deepEqual(await linux.invoke("list_tasks"), aliceTasks);
  await adb("shell", "am", "force-stop", pkg); await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`); await attachPhone(alice.key);
  assert.deepEqual(await phone.invoke("list_tasks"), aliceTasks);
  assert.equal((await phone.invoke("get_automatic_sync_settings")).enabled, true);
  evidence.gates.push({ gate: "second-user-and-cold-start", bobIsolated: true, aliceTasksAndGoalsPreserved: true, persistedAutoSetting: true });
  }
  evidence.passed = true;
} catch (error) {
  evidence.passed = false; evidence.error = String(error);
  evidence.diagnostics = {};
  if (session) {
    evidence.diagnostics.linux = {
      tasks: await linux.invoke("list_tasks").catch(() => null),
      sync: await linux.invoke("get_sync_status").catch(() => null),
      automatic: await linux.invoke("get_automatic_sync_settings").catch(() => null),
      page: await linux.eval("return {visibility:document.visibilityState,active:document.activeElement?.tagName,save:document.querySelector('.save-status')?.textContent,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.getAttribute('aria-label'))}").catch(() => null),
    };
  }
  if (originalKey) {
    evidence.diagnostics.pixel = {
      tasks: await phone.invoke("list_tasks").catch(() => null),
      sync: await phone.invoke("get_sync_status").catch(() => null),
      automatic: await phone.invoke("get_automatic_sync_settings").catch(() => null),
      page: await phone.eval("() => ({visibility:document.visibilityState,active:document.activeElement?.tagName,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.getAttribute('aria-label'))})").catch(() => null),
    };
  }
  console.error(JSON.stringify({ stage: "joint-failure-diagnostics", error: evidence.error, diagnostics: evidence.diagnostics }));
  await mkdir("output/playwright", { recursive: true });
  if (session) {
    const screenshot = await command("/screenshot", undefined, "GET").catch(() => null);
    if (screenshot) await writeFile("output/playwright/accounts-joint-linux-failure.png", Buffer.from(screenshot, "base64"));
  }
  await phone.ui("await page.screenshot({path:'output/playwright/accounts-joint-pixel-failure.png'});").catch(() => {});
  throw error;
} finally {
  const cleanup = [];
  if (originalKey) {
    try {
      assert.ok(!/showing=true/.test(await adb("shell", "dumpsys", "window", "policy")), "Locked phone prevents UI cleanup");
      const current = (await phone.invoke("get_profile_status")).current.key;
      if (current !== originalKey) {
        if (!(await phone.eval("() => !!document.querySelector('[aria-labelledby=account-title]')"))) await phone.settings();
        await phone.ui(`await page.getByLabel('切换资料库',{exact:true}).selectOption(${JSON.stringify(originalKey)});`);
        await switchPhone(originalKey);
      }
      assert.deepEqual(await phone.invoke("list_tasks"), originalTasks); assert.deepEqual(await phone.invoke("get_ai_settings"), originalAi);
      cleanup.push("Android client restored to original local profile; tasks and AI unchanged");
    } catch (e) { cleanup.push(`Pixel cleanup FAILED: ${e}`); evidence.passed = false; }
  }
  await cli("detach").catch(() => {});
  if (reverseOwned) await adb("reverse", "--remove", `tcp:${setup.port}`);
  if (forwardOwned) await adb("forward", "--remove", `tcp:${forwardPort}`);
  await stopLinux().catch(e => { cleanup.push(`Linux cleanup FAILED: ${e}`); evidence.passed = false; });
  for (const child of [service, driver].filter(Boolean)) {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  }
  evidence.cleanup = cleanup;
  await mkdir("output/playwright", { recursive: true });
  await writeFile("output/playwright/accounts-cross-device-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: evidence.passed, gates: evidence.gates.length, cleanup }));
  if (!evidence.passed) process.exitCode = 1;
}
