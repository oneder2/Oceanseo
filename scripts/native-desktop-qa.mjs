// W3C WebDriver against an isolated native Tauri window, never the daily app.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [mode, root, suppliedSession] = process.argv.slice(2);
assert.match(root ?? "", /^\/tmp\/oceanseo-native-ui-[A-Za-z0-9]+$/);
const endpoint = "http://127.0.0.1:4447";
let session = suppliedSession;
const evidenceFile = path.join(root, "evidence.json");
const elementKey = "element-6066-11e4-a52e-4f735466cecf";
const title = "原生升级验收：保留任务与笔记";
const notes = "0.17.0 保存的笔记：检查日期、任务和本机备份。";
const draft = "0.17.0 未提交草稿：升级后继续整理。";

async function request(route, body, method = "POST") {
  const response = await fetch(`${endpoint}${route}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.ok(response.ok && !result.value?.error, JSON.stringify(result));
  return result.value;
}
const command = (route, body, method) => request(`/session/${session}${route}`, body, method);
const js = (script, ...args) => command("/execute/sync", { script, args });
async function invoke(name, args = {}) {
  const result = await command("/execute/async", {
    script: "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}))", args: [name, args],
  });
  assert.ok(!result.error, result.error);
  return result.value;
}
async function wait(fn, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(message);
}
async function find(selector, text) {
  return js("const [selector,text]=arguments; const e=[...document.querySelectorAll(selector)].find(e=>e.getClientRects().length && (text===null || e.textContent.trim()===text || e.getAttribute('aria-label')===text)); return e || null;", selector, text ?? null);
}
async function element(selector, text) {
  let value;
  await wait(async () => !!(value = await find(selector, text)), `Missing ${selector}: ${text ?? ""}`);
  return value[elementKey];
}
async function click(selector, text) {
  await command(`/element/${await element(selector, text)}/click`, {});
}
async function fill(selector, value) {
  const id = await element(selector);
  await command(`/element/${id}/clear`, {});
  await command(`/element/${id}/value`, { text: value });
}
async function guard(version) {
  await wait(() => js("return !!window.__TAURI_INTERNALS__ && document.querySelectorAll('button').length>10"), "Native app did not load");
  await command("/timeouts", { script: 60000, implicit: 0 });
  assert.equal(await invoke("plugin:path|resolve_directory", { directory: 14 }), `${root}/data/com.tideplan.desktop`);
  assert.equal(await invoke("plugin:app|version"), version);
}
async function screenshot(name) {
  await mkdir("output/playwright", { recursive: true });
  const bytes = await command("/screenshot", undefined, "GET");
  await writeFile(`output/playwright/${name}.png`, Buffer.from(bytes, "base64"));
}
async function notebook() {
  await click("button", "所有计划");
  await click("button", `${title}的记事本`);
}
async function persistEvidence(evidence) {
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
}

if (mode === "baseline") {
  if (!session) {
    const value = await request("/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: `${root}/old/usr/bin/tideplan` } } } });
    session = value.sessionId;
    console.log(JSON.stringify({ session }));
  }
  await guard("0.17.0");
  const existing = await invoke("list_tasks");
  assert.ok(existing.length === 0 || (existing.length === 1 && existing[0].title === title), "Unexpected isolated baseline data");
  await command("/window/rect", { width: 1300, height: 900 });
  if (!existing.length) {
    await click("button", "添加计划");
    await fill("[role=dialog] input[maxlength='200']", title);
    await fill("[role=dialog] textarea", notes);
    await click("[role=dialog] button", "保存计划");
    await wait(async () => (await invoke("list_tasks")).length === 1, "Task not saved");
  }
  await notebook();
  await fill("#task-notebook", `${notes}\n通过事项记事本保存。`);
  await click("[role=dialog] button", "保存笔记");
  await wait(async () => (await invoke("list_tasks"))[0].notes.endsWith("通过事项记事本保存。"), "Notebook not saved");
  await notebook();
  await fill("#task-notebook", draft);
  await click("button", "关闭记事本");
  const task = (await invoke("list_tasks"))[0];
  const backup = await invoke("export_data_backup");
  const drafts = await js("return Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('tideplan.draft.')))");
  assert.ok(Object.values(drafts).some(value => value.includes(draft)), "Unsaved draft missing");
  await persistEvidence({ baseline: { version: "0.17.0", task, backup, drafts, at: new Date().toISOString() }, session });
  await screenshot("oceanseo-native-017-baseline");
  console.log(JSON.stringify({ gate: "native-017-baseline", id: task.id, draftSaved: true, session }));
} else if (mode === "upgrade") {
  const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
  if (session) await request(`/session/${session}`, undefined, "DELETE");
  const value = await request("/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: path.resolve("src-tauri/target/release/tideplan") } } } });
  session = value.sessionId;
  evidence.session = session;
  await persistEvidence(evidence);
  console.log(JSON.stringify({ session }));
  await guard("0.18.0");
  assert.equal(await js("return document.title"), "Oceanseo");
  assert.deepEqual(await invoke("list_tasks"), [evidence.baseline.task]);
  await command("/window/rect", { width: 1300, height: 900 });
  await notebook();
  assert.equal(await js("return document.querySelector('#task-notebook').value"), draft);
  await click("button", "保存笔记");
  await wait(async () => (await invoke("list_tasks"))[0].notes === draft, "Upgrade draft save failed");
  const currentBackup = await invoke("export_data_backup");
  await click("button", "新计划");
  await fill("[role=dialog] input[maxlength='200']", "隔离恢复验收：可丢弃的测试任务");
  await click("[role=dialog] button", "保存计划");
  await wait(async () => (await invoke("list_tasks")).length === 2, "Restore probe not saved");
  const snapshot = await invoke("restore_data_backup", { backup: currentBackup });
  assert.ok(snapshot.startsWith(`${root}/data/com.tideplan.desktop/`), "Unexpected recovery destination");
  await js("location.reload(); return true");
  await guard("0.18.0");
  assert.deepEqual(await invoke("list_tasks"), currentBackup.tasks);
  await screenshot("oceanseo-native-018-upgrade");
  evidence.upgrade = { version: "0.18.0", taskAndIdPreserved: true, draftPreserved: true, backupRestore: true, snapshot, at: new Date().toISOString() };
  evidence.session = session;
  await persistEvidence(evidence);
  console.log(JSON.stringify({ gate: "native-018-upgrade-and-core-backup", session, snapshot }));
} else if (mode === "relaunch") {
  await guard("0.18.0");
  const before = await invoke("list_tasks");
  await request(`/session/${session}`, undefined, "DELETE");
  const value = await request("/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: path.resolve("src-tauri/target/release/tideplan") } } } });
  session = value.sessionId;
  await guard("0.18.0");
  assert.deepEqual(await invoke("list_tasks"), before);
  assert.equal(await js("return document.title"), "Oceanseo");
  await command("/window/rect", { width: 1300, height: 900 });
  const surfaces = [];
  for (const [name, background] of [["light", "#ffffff"], ["dark", "#153d3a"]]) {
    await js("document.body.style.background=arguments[0]; return true", background);
    const surface = await js("const s=getComputedStyle(document.querySelector('.workspace')); return {background:s.backgroundColor,color:s.color}");
    assert.equal(surface.background, "rgb(255, 255, 255)", "Reading surface must remain opaque");
    await screenshot(`oceanseo-native-final-${name}`);
    surfaces.push({ name, ...surface });
  }
  await js("document.body.style.background=''; return true");
  const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
  evidence.session = session;
  evidence.finalBuild = { taskDataPreserved: true, surfaces, at: new Date().toISOString() };
  await persistEvidence(evidence);
  console.log(JSON.stringify({ gate: "native-final-build-relaunch", session, tasks: before.length, surfaces }));
} else if (mode === "inspect") {
  await guard("0.18.0");
  console.log(JSON.stringify({ session, tasks: await invoke("list_tasks"), text: await js("return document.body.innerText") }));
} else if (mode === "workflow") {
  await guard("0.18.0");
  const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
  await click("button", "偏好设置");
  await fill(".ai-key-input input", "tideplan-local-test");
  await fill(".ai-settings-fields input[type=url]", "http://127.0.0.1:4319/v1");
  await click("button", "保存 AI 配置");
  await wait(() => js("return document.body.innerText.includes('AI 服务配置已保存')"), "AI config not saved");
  assert.ok((await invoke("test_ai_connection")).includes("连接成功"));
  await click("[role=dialog] button", "关闭");
  await click("button", "想法与目标");
  await fill("textarea[aria-label='给小汐的消息']", "先验证升级与恢复，再发布；也想安排旅行，但目的还没想好。");
  await click("button", "发送消息");
  await wait(() => js("return document.body.innerText.includes('发布可以先从验证开始')"), "Native AI reply missing", 60000);
  await click("button", "查看理解图");
  assert.equal(await js("return document.querySelector('[aria-label=理解图]').querySelectorAll('input,textarea,select,[contenteditable=true]').length"), 0);
  await click("button", "关闭理解图");
  await click("button", "打开交付清单");
  await click("button", "执行全部可执行项（2）");
  await wait(async () => (await invoke("list_tasks")).some(task => task.title === "验证升级与恢复"), "Native delivery failed");
  let task = (await invoke("list_tasks")).find(task => task.title === "验证升级与恢复");
  assert.equal(task.due_date, new Date().toISOString().slice(0, 10));
  await screenshot("oceanseo-native-018-delivery");
  await click("button", "关闭最终交付清单");
  await click("button", "计划日历");
  await click(".calendar-controls button", "今天");
  await wait(() => js("return document.querySelector('.calendar-grid').innerText.includes('验证升级与恢复')"), "Calendar mapping failed");
  await screenshot("oceanseo-native-018-calendar");
  await click("button", "所有计划");
  await click("button", "验证升级与恢复的记事本");
  await fill("#task-notebook", "Linux 原生端到端验收：由对话确认创建，日历查看后完成。");
  await click("button", "保存笔记");
  const card = await js("return [...document.querySelectorAll('.task-card')].find(e=>e.innerText.includes('验证升级与恢复')).querySelector('.check-button')");
  await command(`/element/${card[elementKey]}/click`, {});
  await wait(async () => !!(await invoke("list_tasks")).find(item => item.id === task.id)?.completed_at, "Completion failed");
  task = (await invoke("list_tasks")).find(item => item.id === task.id);
  evidence.workflow = { task, nativeAIHttp: true, readonlyMap: true, delivery: true, calendar: true, notebook: true, completion: true, at: new Date().toISOString() };
  await persistEvidence(evidence);
  console.log(JSON.stringify({ gate: "native-desktop-core-workflow", id: task.id, completed: !!task.completed_at }));
} else if (["sync-publish", "sync-receive"].includes(mode)) {
  await guard("0.18.0");
  await click("button", "偏好设置");
  if (mode === "sync-publish") {
    await fill("input[aria-label='同步服务地址']", "http://127.0.0.1:4789");
    await fill("input[aria-label='同步访问令牌']", "tideplan-local-test-token-not-for-production-123456");
    await click("button", "保存同步配置");
    await wait(() => js("return document.querySelector('.sync-settings').innerText.includes('配置已保存')"), "Sync config not saved");
  }
  await click("button", "检查更改");
  await wait(() => find("button", "确认同步并重新载入"), "Sync preview missing", 60000);
  assert.equal(await js("return document.querySelectorAll('.sync-conflict').length"), 0, "Unexpected conflicts; do not auto-resolve");
  await screenshot(`oceanseo-native-${mode}`);
  await click("button", "确认同步并重新载入");
  await wait(async () => !(await find(".settings-modal")), "Sync reload missing", 60000);
  await guard("0.18.0");
  const evidence = JSON.parse(await readFile(evidenceFile, "utf8"));
  evidence[mode] = { status: await invoke("get_sync_status"), tasks: await invoke("list_tasks"), at: new Date().toISOString() };
  await persistEvidence(evidence);
  console.log(JSON.stringify({ gate: mode, status: evidence[mode].status, tasks: evidence[mode].tasks }));
} else {
  throw Error("Unknown native QA mode");
}
