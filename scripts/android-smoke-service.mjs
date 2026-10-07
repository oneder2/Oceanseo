// Local synthetic service for APK integration tests. Never forward real keys,
// photos or user data. adb reverse tcp:4319 tcp:4319 exposes this to a test APK.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/dialogue-reply.json", import.meta.url)));
fixture.plan.actions[0].draft.dueDate = new Date().toISOString().slice(0, 10);
http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/responses" || req.headers.authorization !== "Bearer tideplan-local-test") {
    res.writeHead(403).end(); return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 500_000) { res.writeHead(413).end(); return; }
  }
  try {
    const data = JSON.parse(raw);
    const name = data.text?.format?.name;
    const output = name === "connection_test" ? { ok: true } : structuredClone(fixture);
    if (name === "life_goal_dialogue") {
      const context = JSON.parse(data.input.find(item => item.role === "user").content);
      const message = context.dialogue.history.filter(item => item.role === "user").at(-1)?.text ?? "";
      if (message.startsWith("最终安装包验收：新增独立验收事项")) {
        // This explicit new-task fixture must not steal a previously executed action's ID.
        const id = `verify-${randomUUID()}`;
        output.plan.actions[0].id = id;
        output.understanding.find(node => node.id === "verify").id = id;
      } else {
        const existing = context.actions.find(action => action.id === "verify");
        if (existing) output.plan.actions[0].existingTaskId = existing.taskId;
      }
      output.plan.actions[0].draft.dueDate = context.today;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }));
    console.log(`synthetic response: ${name === "connection_test" ? "connection test" : "dialogue"}`);
  } catch { res.writeHead(400).end(); }
}).listen(4319, "127.0.0.1", () => console.log("Local synthetic service ready on 127.0.0.1:4319; accepts test credential only."));
