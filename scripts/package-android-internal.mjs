// Validate and publish a local immutable internal APK; never generates keys.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile, constants } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const sdk = process.env.ANDROID_HOME ?? "/home/gellar/Android/Sdk";
const buildTools = path.join(sdk, "build-tools/36.1.0");
const source = "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk";
const destination = `src-tauri/target/release/bundle/apk/Tideplan_${version}_android_arm64_internal.apk`;
function run(tool, args) {
  const result = spawnSync(path.join(buildTools, tool), args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const manifest = run("aapt", ["dump", "badging", source]);
const packageLine = manifest.split("\n")[0];
assert.ok(packageLine.includes("name='com.tideplan.mobile.debug'"), "Refusing non-daily internal package for deliverable");
assert.ok(packageLine.includes(`versionName='${version}-internal'`), "Stale APK version");
assert.ok(manifest.includes("native-code: 'arm64-v8a'"), "Unexpected architectures");
const signature = run("apksigner", ["verify", "--print-certs", source]);
const certificate = signature.match(/certificate SHA-256 digest: ([a-f0-9]+)/)?.[1];
assert.ok(certificate, "Signing certificate missing");
const previous = "src-tauri/target/release/bundle/apk/Tideplan_0.17.0_android_arm64_internal.apk";
assert.ok(run("apksigner", ["verify", "--print-certs", previous]).includes(`certificate SHA-256 digest: ${certificate}`), "Upgrade signing mismatch");
run("zipalign", ["-c", "-P", "16", "4", source]);
await mkdir(path.dirname(destination), { recursive: true });
const bytes = await readFile(source);
const sha256 = createHash("sha256").update(bytes).digest("hex");
try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
catch (error) {
  if (error.code !== "EEXIST") throw error;
  assert.equal(createHash("sha256").update(await readFile(destination)).digest("hex"), sha256, "Refusing to replace an existing version with different bytes");
}
await writeFile(`${destination}.sha256`, `${sha256}  ${path.basename(destination)}\n`);
const report = { version, package: "com.tideplan.mobile.debug", bytes: bytes.length, sha256, certificate, alignment: "16 KB", path: path.resolve(destination) };
await mkdir("output/playwright", { recursive: true });
await writeFile("output/playwright/android-018-package.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
