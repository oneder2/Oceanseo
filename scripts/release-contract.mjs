import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const files = {
  caddy: "services/deployment/Caddyfile",
  accountsHealth: "services/accounts/server.py",
  syncHealth: "services/sync/server.py",
  ci: ".github/workflows/ci.yml",
  android: ".github/workflows/android.yml",
  androidRelease: ".github/workflows/android-release.yml",
  backupAudit: "services/deployment/backup-audit.py",
  backupAlert: "services/deployment/backup-alert.py",
  backupAlertUnit: "services/deployment/oceanseo-backup-alert@.service",
  deployServices: "services/deployment/deploy-services.sh",
  syncAuditUnit: "services/deployment/tideplan-backup-audit.service",
  accountsAuditUnit: "services/deployment/oceanseo-accounts-backup-audit.service",
  syncAuditTimer: "services/deployment/tideplan-backup-audit.timer",
  accountsAuditTimer: "services/deployment/oceanseo-accounts-backup-audit.timer",
  syncServer: "services/sync/server.py",
  accountsServer: "services/accounts/store.py",
  accountsApi: "services/accounts/server.py",
  androidReleaseVerify: "scripts/android-release-verify.mjs",
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
assert.match(source.androidRelease, /workflow_dispatch/);
assert.match(source.androidRelease, /TIDEPLAN_KEYSTORE_BASE64/);
assert.match(source.androidRelease, /npm run android:release/);
assert.match(source.androidRelease, /apksigner/);
assert.doesNotMatch(source.ci, /TIDEPLAN_KEYSTORE_PASSWORD/);
assert.match(source.backupAudit, /PRAGMA integrity_check/);
assert.match(source.backupAudit, /max-age-hours/);
assert.match(source.backupAlert, /OCEANSEO_ALERT_WEBHOOK_URL/);
assert.match(source.backupAlert, /backup_audit_failed/);
assert.match(source.backupAlert, /must be an HTTPS URL/);
assert.match(source.backupAlertUnit, /ConditionPathExists=\/etc\/oceanseo-alert\.env/);
assert.match(source.backupAlertUnit, /DynamicUser=true/);
assert.match(source.syncAuditUnit, /\/opt\/tideplan-sync\/backup-audit.py/);
assert.match(source.accountsAuditUnit, /\/opt\/oceanseo-accounts\/services\/deployment\/backup-audit.py/);
assert.match(source.syncAuditUnit, /OnFailure=oceanseo-backup-alert@sync\.service/);
assert.match(source.accountsAuditUnit, /OnFailure=oceanseo-backup-alert@accounts\.service/);
assert.ok(
  source.deployServices.indexOf("wait_for curl --fail --silent --show-error --max-time 2 http:\/\/127.0.0.1:4791\/v2\/health") <
    source.deployServices.indexOf(
      "start_audit tideplan-backup-audit.service",
      source.deployServices.indexOf("sudo systemctl enable tideplan-backup-audit.timer"),
    ),
  "deployment must wait for service health before starting backup audits",
);
assert.match(source.deployServices, /start_audit\(\) \{/);
assert.match(source.deployServices, /systemctl reset-failed "\$unit"/);
assert.match(source.syncAuditTimer, /Persistent=true/);
assert.match(source.accountsAuditTimer, /Persistent=true/);
assert.match(source.syncServer, /backup_status/);
assert.match(source.syncServer, /30 \* 3600/);
assert.match(source.accountsServer, /backup_status/);
assert.match(source.accountsServer, /30 \* 3600/);
assert.match(source.accountsServer, /delete_account/);
assert.match(source.accountsServer, /confirmation != "DELETE"/);
assert.match(source.accountsApi, /route == "\/v2\/account"/);
assert.match(source.accountsApi, /self\.command == "DELETE"/);
assert.match(source.ci, /npm run test:sync-server/);
assert.match(source.ci, /npm run test:accounts-server/);
assert.match(source.ci, /npm run test:backup-alert/);
assert.match(source.androidRelease, /android-release-verify\.mjs/);
assert.match(source.androidReleaseVerify, /com\.tideplan\.mobile/);
assert.match(source.androidReleaseVerify, /jarsigner/);
assert.match(source.androidReleaseVerify, /certificateSha256/);

const report = {
  contract: "internal-beta-release",
  serviceHealth: ["/health/accounts", "/health/sync"],
  secretPolicy: "formal signing secrets are external to CI and repository",
  androidArtifactHashes: true,
  backupAudit: {
    freshnessHours: 30,
    checks: ["private mode", "sqlite integrity", "required schema"],
    timers: ["sync", "accounts"],
  },
  backupAlert: { provider: "generic HTTPS webhook", enabledByDefault: false },
  generatedAt: new Date().toISOString(),
};
await mkdir("output/playwright", { recursive: true });
await writeFile("output/playwright/release-contract.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
