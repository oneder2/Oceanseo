// Real WebKit/GTK window in isolated data and D-Bus; never opens the daily profile.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";

const [binary, driverPath] = process.argv.slice(2);
assert.ok(binary && driverPath, "Supply candidate binary and WebKitWebDriver");
const execute = promisify(execFile);
const autostart = path.join(os.homedir(), ".config/autostart/Tideplan.desktop");
const previous = await readFile(autostart).catch(e => { if (e.code !== "ENOENT") throw e; return null; });
const root = await mkdtemp("/tmp/oceanseo-tools-polish-");
for (const name of ["data", "config", "cache"]) await mkdir(`${root}/${name}`, { mode: 0o700 });
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const port = s.address().port; s.close(() => resolve(port)); }); });
const bus = spawn("dbus-daemon", ["--session", "--nofork", "--print-address=1"], { stdio: ["ignore", "pipe", "ignore"] });
const address = await new Promise((resolve, reject) => { let raw = ""; bus.stdout.on("data", b => { raw += b; if (raw.includes("\n")) resolve(raw.split("\n")[0]); }); bus.once("error", reject); });
const driver = spawn(driverPath, [`--port=${port}`], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, XDG_DATA_HOME: `${root}/data`, XDG_CONFIG_HOME: `${root}/config`, XDG_CACHE_HOME: `${root}/cache`, TAURI_WEBVIEW_AUTOMATION: "true" }, stdio: ["ignore", "ignore", "pipe"] });
let session;
async function request(route, body, method = "POST") {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result.value;
}
const cmd = (route, body, method) => request(`/session/${session}${route}`, body, method);
const js = (script, ...args) => cmd("/execute/sync", { script, args });
async function ipc(name, args = {}) {
  const r = await cmd("/execute/async", { script: "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));", args: [name, args] });
  assert.ok(!r.error, `${name}: ${r.error}`); return r.value;
}
async function wait(fn, label) { const end = Date.now() + 60000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 150)); } throw Error(label); }
const click = label => js("const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===arguments[0] || b.textContent.trim()===arguments[0]);if(!b)throw Error('Button not found: '+arguments[0]);b.click();return true", label);
async function screenshot(name) { await writeFile(`output/playwright/${name}.png`, Buffer.from(await cmd("/screenshot", undefined, "GET"), "base64")); }
try {
  await wait(async () => { try { return (await fetch(`http://127.0.0.1:${port}/status`)).ok; } catch { return false; } }, "Driver not ready");
  session = (await request("/session", { capabilities: { alwaysMatch: { "webkitgtk:browserOptions": { binary: path.resolve(binary) } } } })).sessionId;
  await cmd("/timeouts", { script: 60000, implicit: 0 });
  await wait(() => js("return !!document.querySelector('.personal-home')"), "Home not ready");
  assert.equal(await ipc("plugin:app|version"), "0.19.2");
  const entry = (await readFile("dist/index.html", "utf8")).match(/src="([^"]+\.js)"/)[1];
  assert.ok((await js("return document.querySelector('script[type=module]').src")).endsWith(entry), "Native must embed the verified frontend");
  await click("添加工具");
  await wait(() => js("return document.querySelectorAll('.scene-tool-card').length===11"), "Library not ready");
  await js("[...document.querySelectorAll('.scene-tool-card')].find(c=>c.querySelector('h4').textContent==='采购清单').querySelector('button').click();return true");
  await wait(() => js("return !document.querySelector('.scene-dialog') && !!document.querySelector('[aria-label=\"移除工具：采购清单\"]')"), "Tool was not installed");
  await click("采购清单");
  await wait(() => js("return !!document.querySelector('input[aria-label=\"物品名称\"]')"), "Shopping tool not mounted");
  const input = await cmd("/element", { using: "css selector", value: 'input[aria-label="物品名称"]' });
  await cmd(`/element/${input["element-6066-11e4-a52e-4f735466cecf"]}/value`, { text: "原生移除恢复资料" });
  await click("添加");
  await wait(() => js("return document.body.textContent.includes('原生移除恢复资料')"), "Native item was not added");
  await click("移除工具：采购清单");
  await wait(() => js("return !!document.querySelector('.personal-home') && !document.querySelector('[aria-label=\"移除工具：采购清单\"]')"), "Removed page did not fall back to home");
  const removed = await ipc("personal_workspaces");
  assert.ok(removed.workspaces[0].tools.find(t => t.module === "shopping-list").archived);
  await click("添加工具");
  await wait(() => js("return document.querySelectorAll('.scene-tool-card').length===11"), "Library not ready after removal");
  await js("[...document.querySelectorAll('.scene-tool-card')].find(c=>c.querySelector('h4').textContent==='采购清单').querySelector('button').click();return true");
  await wait(() => js("return !document.querySelector('.scene-dialog') && !!document.querySelector('[aria-label=\"移除工具：采购清单\"]')"), "Tool not restored");
  const backup = await ipc("export_data_backup", { personalScope: "main" });
  assert.equal(backup.appState["tideplan.purchase-list.v1"][0].name, "原生移除恢复资料");

  const before = await cmd("/window/rect", undefined, "GET");
  await click("进入全屏");
  await wait(() => js("return !!document.querySelector('.desktop-shell.is-fullscreen')"), "Native maximization did not complete");
  const rootProps = (await execute("xprop", ["-root", "_NET_WORKAREA", "_NET_CURRENT_DESKTOP", "_NET_CLIENT_LIST"])).stdout;
  const desktop = Number(rootProps.match(/_NET_CURRENT_DESKTOP[^=]*=\s*(\d+)/)[1]);
  const area = rootProps.match(/_NET_WORKAREA[^=]*=([^\n]+)/)[1].split(",").map(Number).slice(desktop * 4, desktop * 4 + 4);
  const windows = rootProps.match(/_NET_CLIENT_LIST[^:]*:\s*([^\n]+)/)[1].match(/0x[\da-f]+/g);
  let windowId, states;
  for (const id of windows) {
    const props = (await execute("xprop", ["-id", id, "_NET_WM_PID", "_NET_WM_STATE"])).stdout;
    const pid = props.match(/_NET_WM_PID[^=]*=\s*(\d+)/)?.[1];
    if (!pid) continue;
    const cwd = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => "");
    if (cwd.includes(`XDG_DATA_HOME=${root}/data`)) { windowId = id; states = props; break; }
  }
  assert.ok(windowId, "Find only the isolated QA window");
  assert.match(states, /_NET_WM_STATE_MAXIMIZED_VERT/);
  assert.match(states, /_NET_WM_STATE_MAXIMIZED_HORZ/);
  assert.doesNotMatch(states, /_NET_WM_STATE_FULLSCREEN/);
  const geometry = (await execute("xwininfo", ["-id", windowId])).stdout;
  const x = Number(geometry.match(/Absolute upper-left X:\s*(-?\d+)/)[1]), y = Number(geometry.match(/Absolute upper-left Y:\s*(-?\d+)/)[1]);
  const w = Number(geometry.match(/Width:\s*(\d+)/)[1]), h = Number(geometry.match(/Height:\s*(\d+)/)[1]);
  assert.ok(x >= area[0] && y >= area[1] && x + w <= area[0] + area[2] && y + h <= area[1] + area[3], "Window must respect the system panel work area");
  await mkdir("output/playwright", { recursive: true });
  await screenshot("personal-tools-polish-native-maximized");
  await js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true");
  await wait(() => js("return !document.querySelector('.desktop-shell.is-fullscreen')"), "Escape must restore normal window");
  const after = await cmd("/window/rect", undefined, "GET");
  assert.equal(after.width, before.width); assert.equal(after.height, before.height);
  const evidence = { version: "0.19.2", frontendMatches: true, nativeToolRemoval: true, nativeDataRecovery: true, maximizedWithoutFullscreen: true, workArea: area, geometry: { x, y, w, h }, before, after };
  await writeFile("output/playwright/personal-tools-polish-native.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  if (session) await request(`/session/${session}`, undefined, "DELETE").catch(() => {});
  driver.kill("SIGTERM"); bus.kill("SIGTERM");
  await new Promise(resolve => { if (driver.exitCode !== null) resolve(); else driver.once("exit", resolve); });
  if (previous !== null) await writeFile(autostart, previous); else await rm(autostart, { force: true });
  await rm(root, { recursive: true, force: true });
}
