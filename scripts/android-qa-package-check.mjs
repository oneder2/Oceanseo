// Read-only APK check. Run before installing any isolated QA build.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

const [apk, expectedVersion = "0.18.0-internal"] = process.argv.slice(2);
assert.ok(apk, "Supply an APK path");
await access(apk);
const sdk = process.env.ANDROID_HOME ?? "/home/gellar/Android/Sdk";
const aapt = path.join(sdk, "build-tools/36.1.0/aapt");
const result = spawnSync(aapt, ["dump", "badging", apk], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const match = result.stdout.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
assert.ok(match, "APK manifest missing");
assert.equal(match[1], "com.tideplan.mobile.uiuxqa", "Refusing daily or unrelated package");
assert.equal(match[3], expectedVersion);
assert.ok(result.stdout.includes("application-label:'Oceanseo · 界面验收'"), "QA label missing");
console.log(JSON.stringify({ package: match[1], versionCode: Number(match[2]), versionName: match[3], apk: path.resolve(apk) }));
