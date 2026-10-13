import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const execute = promisify(execFile), serial = process.argv[2];
assert.equal(serial, "emulator-5590", "Only the disposable P1 emulator is supported");
const pkg = "com.tideplan.mobile.uiuxqa", artifact = process.argv[3], testArtifact = process.argv[4];
assert.ok(artifact && testArtifact, "Supply the frozen main and instrumentation APK paths");
const adb = async (...args) => (await execute("adb", ["-s", serial, ...args], { timeout: 45000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
assert.equal(await adb("shell", "getprop", "ro.kernel.qemu"), "1");
const evidence = { actualAndroid: true, actualAlarmManager: true, serial, physicalDevice: false, package: pkg, artifact, testArtifact,
  sha256: createHash("sha256").update(await readFile(artifact)).digest("hex"), gates: [] };
const phase = async (name, mode) => {
  const result = await adb("shell", "am", "instrument", "-w", "-r", "-e", "class", "com.tideplan.mobile.ReminderColdStartTest",
    "-e", "qaColdPhase", name, ...(mode ? ["-e", "qaColdMode", mode] : []), `${pkg}.test/androidx.test.runner.AndroidJUnitRunner`);
  assert.ok(result.includes("OK (1 test)") && !result.includes("FAILURES!!!"), result);
  return result;
};
const prefs = () => adb("shell", "run-as", pkg, "cat", "shared_prefs/tideplan-reminders.xml");
let prepared = false;
try {
  await adb("install", "-r", artifact);
  await adb("install", "-r", testArtifact);
  for (const mode of ["account", "revoked", "switch"]) {
    console.log(JSON.stringify({ stage: "cold-reminder-prepare", mode }));
    const previousSelection = await adb("shell", "run-as", pkg, "cat", "profile-selection.json");
    const previousPrefs = await prefs();
    prepared = true; // Restore partial fixtures too if prepare fails.
    const prepareLog = await phase("prepare", mode);
    const state = JSON.parse(await adb("shell", "run-as", pkg, "cat", "cache/qa-reminder-cold.json"));
    // am kill removes a cached process while preserving alarms; force-stop would
    // cancel alarms and cannot verify process-death behavior.
    await adb("shell", "am", "kill", pkg);
    const deadline = Date.now() + 120000;
    let gone = false, completed = false;
    while (Date.now() < deadline) {
      const pid = await adb("shell", "pidof", pkg).catch(() => "");
      if (!pid) gone = true;
      const raw = await prefs();
      completed = mode === "account" ? raw.includes(`name="last-${state.owner}-0"`) : !raw.includes('name="next-0"');
      if (completed) break;
      assert.ok(Date.now() < state.due || gone, "The scheduled alarm became due before target process death was observed");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(gone, "Could not verify that the target app process was absent before delivery");
    assert.ok(completed, "Real inexact alarm did not complete in the bounded observation window");
    const deliveryPid = await adb("shell", "pidof", pkg).catch(() => "");
    const verifyLog = await phase("verify");
    const restoreLog = await phase("restore");
    prepared = false;
    assert.equal(await adb("shell", "run-as", pkg, "cat", "profile-selection.json"), previousSelection);
    assert.equal(await prefs(), previousPrefs, "Reminder preferences were not restored byte-for-byte");
    evidence.gates.push({ mode, targetProcessDeathObserved: gone, deliveredAfterDue: Date.now() >= state.due, deliveryPid,
      prepareLog, verifyLog, restoreLog, restored: true });
    console.log(JSON.stringify({ stage: "cold-reminder-passed", mode, deliveryPid }));
  }
  await writeFile("output/playwright/module-android-cold-reminders-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
} catch (error) {
  if (prepared) { try { await phase("restore"); prepared = false; } catch (restoreError) { evidence.restoreFailure = String(restoreError); } }
  evidence.failure = String(error);
  await writeFile("output/playwright/module-android-cold-reminders-failure.json", JSON.stringify(evidence, null, 2) + "\n");
  throw error;
}
