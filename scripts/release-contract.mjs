import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const files = {
  caddy: "services/deployment/Caddyfile",
  accountsHealth: "services/accounts/server.py",
  syncHealth: "services/sync/server.py",
  ci: ".github/workflows/ci.yml",
  android: ".github/workflows/android.yml",
};
const source = Object.fromEntries(await Promise.all(
  Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")]),
));

assert.match(source.caddy, /handle \/health\/accounts/);
assert.match(source.caddy, /handle \/health\/sync/);
assert.match(source.accountsHealth, /route == "\/v2\/health"/);
assert.match(source.syncHealth, /self\.path == "\/health"/);
assert.match(source.ci, /npm run test:release-contract/);
assert.match(source.android, /sha256sum/);
assert.doesNotMatch(source.ci, /TIDEPLAN_KEYSTORE_PASSWORD/);

const report = {
  contract: "internal-beta-release",
  serviceHealth: ["/health/accounts", "/health/sync"],
  secretPolicy: "formal signing secrets are external to CI and repository",
  androidArtifactHashes: true,
  generatedAt: new Date().toISOString(),
};
await mkdir("output/playwright", { recursive: true });
await writeFile("output/playwright/release-contract.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
