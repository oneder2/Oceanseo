#!/usr/bin/env node
/** Remove only allowlisted reproducible outputs; keep source and QA evidence. */
import { readdir, lstat, realpath, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const allowed = new Set(["--apply", "--deep", "--if-idle", "--enforce-budget"]);
if (args.some(arg => !allowed.has(arg))) throw Error("Usage: node scripts/build-cleanup.mjs [--apply] [--deep] [--enforce-budget] [--if-idle]");
const apply = args.includes("--apply"), budget = 8 * 1024 ** 3;
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const present = async relative => { try { return await lstat(path.join(root, relative)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const size = relative => {
  const output = execFileSync("du", ["-s", "-B1", "--", path.join(root, relative)], { encoding: "utf8" });
  return Number(output.trim().split(/\s+/)[0]);
};
async function activeBuilders() {
  const found = [];
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
      const exe = path.basename(argv[0] ?? "");
      // An idle Gradle daemon is reusable infrastructure, not an active task.
      const building = ["cargo", "rustc", "gradle", "gradlew"].includes(exe)
        || argv.some(arg => arg.includes("org.gradle.wrapper.GradleWrapperMain"))
        || (exe === "node" && argv.some(arg => /(?:^|\/)vite(?:\.js)?$/.test(arg)) && argv.includes("build"));
      if (!building) continue;
      const cwd = await realpath(`/proc/${pid}/cwd`);
      if (cwd === root || cwd.startsWith(root + path.sep) || argv.some(arg => arg.startsWith(root + path.sep))) found.push({ pid: Number(pid), program: exe });
    } catch (error) { if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error; }
  }
  return found;
}

async function cleanup() {
  const active = await activeBuilders();
  if (active.length) {
    if (args.includes("--if-idle")) { console.log(JSON.stringify({ skipped: true, reason: "active_build", active })); return; }
    throw Error("Builds are running in this workspace; retry cleanup after they finish.");
  }
  const targetBytes = await present("src-tauri/target") ? size("src-tauri/target") : 0;
  const deep = args.includes("--deep") || args.includes("--enforce-budget") && targetBytes > budget;
  const candidates = [];
  async function add(relative, reason) {
    const info = await present(relative);
    if (!info) return;
    if (info.isSymbolicLink()) throw Error(`Refusing symbolic-link cleanup root: ${relative}`);
    const resolved = await realpath(path.join(root, relative));
    if (!resolved.startsWith(root + path.sep) || tracked.some(name => name === relative || name.startsWith(relative + "/"))) throw Error(`Source/provenance guard rejected: ${relative}`);
    candidates.push({ path: relative, reason, bytes: size(relative) });
  }
  if (deep) await add("src-tauri/target", "Cargo cache reset");
  else {
    for (const prefix of ["src-tauri/target", "src-tauri/target/aarch64-linux-android", "src-tauri/target/x86_64-linux-android"])
      for (const profile of ["debug", "release"]) await add(`${prefix}/${profile}/incremental`, "Cargo incremental cache");
  }
  // Keep app/build/outputs: a signed or personal package may exist only there.
  for (const directory of ["src-tauri/gen/android/app/build/intermediates", "src-tauri/gen/android/app/build/tmp",
    "src-tauri/gen/android/app/build/generated", "src-tauri/gen/android/app/build/kotlin", "src-tauri/gen/android/app/build/.transforms",
    "src-tauri/gen/android/build", "src-tauri/gen/android/buildSrc/build",
    "src-tauri/gen/android/.gradle", "src-tauri/gen/android/buildSrc/.gradle", "node_modules/.vite"])
    await add(directory, "Reproducible build output");
  if (deep) {
    await add("src-tauri/gen/android/app/src/main/jniLibs", "Generated native-library links");
    for (const directory of ["dist-web", "dist-commercial-android"]) {
      if (await present(`${directory}/index.html`) && await present(`${directory}/assets`)) await add(directory, "Generated commercial Web output");
    }
  }

  // Archived packages and historical QA evidence are preserved.
  const beforeBytes = size(".");
  if (apply) {
    // Recheck immediately before mutation; automatic hooks skip concurrent builds.
    if ((await activeBuilders()).length) throw Error("A build started during inspection; cleanup cancelled.");
    for (const candidate of candidates) await rm(path.join(root, candidate.path), { recursive: true, force: true });
  }
  const afterBytes = apply ? size(".") : beforeBytes;
  const report = { mode: apply ? "applied" : "dry-run", deep, targetBudgetBytes: budget, beforeBytes, afterBytes,
    freedBytes: beforeBytes - afterBytes, estimatedCandidateBytes: candidates.reduce((sum, entry) => sum + entry.bytes, 0), candidates };
  if (apply) {
    await mkdir(path.join(root, "output/personal"), { recursive: true });
    await writeFile(path.join(root, "output/personal/build-cleanup-latest.json"), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}

// Serialize cleanup invocations. A stale lock is removed only after its process
// is confirmed absent; a lock file alone never proves a build is running.
const lock = path.join(root, "output/personal/build-cleanup.lock");
await mkdir(path.dirname(lock), { recursive: true });
try {
  await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const pid = Number(await readFile(lock, "utf8"));
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error("Invalid cleanup lock; inspect it before retrying.");
  let alive = true;
  try { process.kill(pid, 0); } catch (check) { if (check.code === "ESRCH") alive = false; else throw check; }
  if (alive) throw Error("Another cleanup process is active.");
  await rm(lock);
  await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
}
try { await cleanup(); } finally { await rm(lock, { force: true }); }
