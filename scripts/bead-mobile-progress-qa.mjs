// Real Android touch + WebView readback. Restricted to the disposable emulator.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";

const exec = promisify(execFile), serial = "emulator-5590", pkg = "com.tideplan.mobile.debug";
const session = `bead-progress-${process.pid}`, port = 9291;
const wrapper = "/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh";
const adb = async (...args) => (await exec("adb", ["-s", serial, ...args], { timeout: 30000 })).stdout.trim();
const cli = async (...args) => (await exec("bash", [wrapper, `-s=${session}`, ...args], { timeout: 60000, maxBuffer: 3 * 1024 * 1024 })).stdout.trim();
const evaluate = async source => JSON.parse(await cli("eval", source, "--raw"));
const invoke = (name, args = {}) => evaluate(`async()=>window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function attach() {
  await cli("detach").catch(() => {});
  const pid = await adb("shell", "pidof", pkg);
  assert.match(pid, /^\d+$/);
  await adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  await cli("attach", `--cdp=http://127.0.0.1:${port}`);
  await cli("snapshot");
  assert.equal((await invoke("get_profile_status")).current.key, "local", "Requires disposable local profile");
}
async function openWorks() {
  await cli("run-code", "async(page)=>{await page.getByRole('navigation',{name:'手机主导航'}).getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('button',{name:'拼豆图纸',exact:true}).click();await page.getByRole('region',{name:'拼豆继续拼'}).waitFor();}", "--raw");
  await cli("snapshot");
}
async function workSnapshot() {
  const backup = await invoke("export_data_backup");
  const doc = backup.appState["tideplan.bead-works.v1"];
  const work = doc.works.find(w => w.id === doc.activeId);
  return { backup, doc, work };
}
async function touchCell(index) {
  const data = await evaluate(`()=>{
    const c=document.querySelector('.bead-mobile-view canvas');
    c.scrollIntoView({block:'center'});
    return {rect:c.getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight};
  }`);
  await pause(200);
  const { work } = await workSnapshot();
  const p = work.versions.find(v => v.id === work.currentVersionId).pattern;
  const r = data.rect, cell = Math.max(1, Math.min(36, (r.width - 88) / p.width, (r.height - 76) / p.height));
  const x = r.left + Math.max(44, (r.width - p.width * cell) / 2) + (index % p.width + 0.5) * cell;
  const y = r.top + Math.max(38, (r.height - p.height * cell) / 2) + (Math.floor(index / p.width) + 0.5) * cell;
  await adb("shell", "uiautomator", "dump", "/sdcard/p3-touch-window.xml").catch(error => {
    // Some emulator images kill the dump process after it successfully writes
    // the hierarchy. Accept only that explicit result and still parse the file.
    if (error.code !== 137 || !error.stdout.includes("UI hierchary dumped to: /sdcard/p3-touch-window.xml")) throw error;
  });
  const xml = await adb("shell", "cat", "/sdcard/p3-touch-window.xml");
  const bounds = xml.match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  assert.ok(bounds, "WebView screen bounds missing");
  assert.ok(xml.includes(`package="${pkg}"`));
  const [left, top, right] = bounds.slice(1).map(Number);
  const ratio = (right - left) / data.width;
  // This goes through Android input, not dispatchEvent or a DOM click.
  await adb("shell", "input", "tap", String(Math.round(left + x * ratio)), String(Math.round(top + y * ratio)));
  await pause(700);
}
let before;
const evidence = { physicalDevice: false, actualAndroidTouch: true, serial, package: pkg, gates: [] };
try {
  await attach();
  console.log("Attached to disposable Android local profile");
  await openWorks();
  await pause(700);
  before = await workSnapshot();
  const pattern = before.work.versions.find(v => v.id === before.work.currentVersionId).pattern;
  assert.deepEqual([pattern.width, pattern.height], [2, 1], "Requires the existing tiny synthetic legacy fixture");
  const index = pattern.cells.findIndex(c => c >= 0);
  assert.ok(index >= 0);
  const originallyMarked = before.work.completedCells.includes(index);
  await touchCell(index);
  let current = await workSnapshot();
  assert.equal(current.work.completedCells.includes(index), !originallyMarked);
  assert.equal(current.work.currentVersionId, before.work.currentVersionId);
  evidence.gates.push("Android input tap changes completion without changing drawing version");
  console.log("Actual touch mark passed");
  await adb("shell", "am", "force-stop", pkg);
  await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`);
  await pause(2000);
  await attach();
  await openWorks();
  await pause(700);
  current = await workSnapshot();
  assert.equal(current.work.completedCells.includes(index), !originallyMarked);
  assert.equal(current.work.currentVersionId, before.work.currentVersionId);
  assert.equal(current.work.versions.length, before.work.versions.length);
  evidence.gates.push("Process restart and page reopening retain progress and version history");
  console.log("Cold restart retained completion and drawing version");
  await touchCell(index);
  current = await workSnapshot();
  assert.equal(current.work.completedCells.includes(index), originallyMarked);
  evidence.gates.push("Second Android tap reverses the mark");
  if (!originallyMarked) await touchCell(index);
  await cli("run-code", "async(page)=>{const b=page.getByRole('button',{name:'清除进度',exact:true});await b.scrollIntoViewIfNeeded();await b.click();}", "--raw");
  await pause(700);
  assert.equal((await workSnapshot()).work.completedCells.length, 0);
  evidence.gates.push("Clear progress removes marks");
  const layout = await evaluate("()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})");
  assert.equal(layout.width, layout.scrollWidth);
  evidence.layout = layout;
  assert.deepEqual((await workSnapshot()).backup.tasks, before.backup.tasks);
  evidence.gates.push("No horizontal overflow; local task records preserved");
  await cli("run-code", "async(page)=>{await page.locator('.bead-mobile-view canvas').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/p3-mobile-progress.png'});}", "--raw");
  const capture = await exec("adb", ["-s", serial, "exec-out", "screencap", "-p"], { encoding: "buffer", timeout: 30000, maxBuffer: 6 * 1024 * 1024 });
  await writeFile("output/playwright/p3-mobile-native.png", capture.stdout);
  await invoke("set_app_state", { key: "tideplan.bead-works.v1", value: null });
  await invoke("set_app_state", { key: "tideplan.bead-pattern.v1", value: null });
  await adb("shell", "am", "force-stop", pkg);
  await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`);
  await pause(2000);
  await attach();
  await openWorks();
  await pause(1000);
  const fresh = await invoke("export_data_backup");
  assert.equal(fresh.appState["tideplan.bead-works.v1"], null, "Opening an empty device must not save a placeholder work");
  assert.equal(fresh.appState["tideplan.bead-pattern.v1"], null);
  evidence.gates.push("Fresh-device placeholder is not saved by merely opening the page");
  evidence.status = "passed";
} finally {
  if (before) {
    await invoke("set_app_state", { key: "tideplan.bead-works.v1", value: before.doc });
    await invoke("set_app_state", { key: "tideplan.bead-pattern.v1", value: before.backup.appState["tideplan.bead-pattern.v1"] ?? null });
    await adb("shell", "am", "force-stop", pkg);
    await adb("shell", "am", "start", "-n", `${pkg}/com.tideplan.mobile.MainActivity`);
  }
  await cli("detach").catch(() => {});
  await adb("forward", "--remove", `tcp:${port}`).catch(() => {});
}
await writeFile("output/p3/mobile-progress-evidence-20261011.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
