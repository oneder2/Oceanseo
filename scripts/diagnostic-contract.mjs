import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/diagnosticReport.ts", import.meta.url), "utf8");
assert.match(source, /export async function exportDiagnosticReport/);
assert.match(source, /schemaVersion: "1\.0\.0"/);
assert.match(source, /baseUrl: redactedOrigin\(input\.aiBaseUrl\)/);
assert.match(source, /任务标题、笔记和正文/);
assert.match(source, /AI API_KEY、同步 Token 和密码/);
for (const forbiddenField of ["aiApiKey", "password", "syncToken", "taskTitles", "taskNotes", "peopleRecords"]) {
  assert.doesNotMatch(source, new RegExp(`\\b${forbiddenField}\\b`), `diagnostic report must not read ${forbiddenField}`);
}
console.log(JSON.stringify({ contract: "redacted-diagnostic-report", excluded: ["business text", "personal records", "AI/API credentials", "sync credentials"] }));
