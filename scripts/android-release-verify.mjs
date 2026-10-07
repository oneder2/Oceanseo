import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const [apkArg, aabArg, metadataArg] = process.argv.slice(2);
assert.ok(apkArg && aabArg && metadataArg, "Usage: node scripts/android-release-verify.mjs APK AAB METADATA");

const apk = path.resolve(apkArg);
const aab = path.resolve(aabArg);
const metadata = path.resolve(metadataArg);
const sdk = process.env.ANDROID_HOME ?? "/home/gellar/Android/Sdk";
const buildTools = path.join(sdk, "build-tools/36.1.0");
const expectedVersion = JSON.parse(await readFile("package.json", "utf8")).version;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

await stat(apk);
await stat(aab);
const badging = run(path.join(buildTools, "aapt"), ["dump", "badging", apk]);
const packageLine = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
assert.ok(packageLine, "APK manifest is missing package metadata");
assert.equal(packageLine[1], "com.tideplan.mobile", "Unexpected release applicationId");
assert.equal(packageLine[3], expectedVersion, "APK version does not match package.json");

run(path.join(buildTools, "apksigner"), ["verify", "--verbose", apk]);
const certificateOutput = run(path.join(buildTools, "apksigner"), ["verify", "--print-certs", apk]);
const certificate = certificateOutput.match(/certificate SHA-256 digest: ([a-f0-9]+)/)?.[1];
assert.ok(certificate, "Signed APK certificate digest is missing");
run("jarsigner", ["-verify", "-strict", aab]);

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

const report = {
  package: packageLine[1],
  versionCode: Number(packageLine[2]),
  versionName: packageLine[3],
  certificateSha256: certificate,
  commit: process.env.GITHUB_SHA ?? "local",
  artifacts: {
    apk: { file: path.basename(apk), bytes: (await stat(apk)).size, sha256: await digest(apk) },
    aab: { file: path.basename(aab), bytes: (await stat(aab)).size, sha256: await digest(aab) },
  },
};
await mkdir(path.dirname(metadata), { recursive: true });
await writeFile(metadata, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report));
