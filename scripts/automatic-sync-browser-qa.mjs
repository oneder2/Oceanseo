import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";

const execute = promisify(execFile);
const wrapper = "/home/gellar/.codex/skills/playwright/scripts/playwright_cli.sh";
const session = `automatic-sync-browser-${process.pid}`;
const cli = async (...args) => (await execute("bash", [wrapper, `-s=${session}`, ...args], {
  timeout: 180000, maxBuffer: 4 * 1024 * 1024,
})).stdout.trim();
try {
  await cli("open", process.argv[2] ?? "http://127.0.0.1:1439");
  await cli("run-code", "--filename=scripts/automatic-sync-ui-smoke.js");
  await cli("run-code", "--filename=scripts/automatic-sync-reload-recovery.js");
  const evidence = JSON.parse(await cli("eval", "() => window.__autoUiEvidence", "--raw"));
  assert.equal(evidence.gates.length, 10);
  assert.deepEqual(evidence.pageErrors, []);
  assert.equal(evidence.actualNative, false);
  await mkdir("output/playwright", { recursive: true });
  await writeFile("output/playwright/automatic-sync-browser-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: true, gates: evidence.gates.length, actualNative: false }));
} finally {
  await cli("close").catch(() => {});
}
