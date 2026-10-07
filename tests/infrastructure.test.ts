import test from "node:test";
import assert from "node:assert/strict";
import {
  attention,
  emptyInfrastructure,
  eventReference,
  hostEvents,
  infrastructureContext,
  latestSample,
  monthlyCosts,
  newHost,
  nextBillingDate,
  recordPayment,
  sampleState,
  validInfrastructure,
  validReport,
  type Sample,
} from "../src/infrastructure/model";
import { makeContext } from "../src/assistant/context";
import { emptyLife } from "../src/life/model";
import fixture from "./fixtures/infrastructure.json";
import { reminderBody } from "../src/useDailyReminders";

test("host reminder recomputes due dates when sent across midnight", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 3, 23, 59) });
  const data = { ...emptyInfrastructure(), hosts: [{ ...newHost(), name: "Reminder", purpose: "test", nextDue: "2026-10-11" }] };
  assert.doesNotMatch(reminderBody([], [], 0, [], data), /主机与服务/);
  t.mock.timers.tick(120000);
  assert.match(reminderBody([], [], 0, [], data), /主机与服务有 1 项待留意/);
});

test("shared native backup fixture is valid on the client", () =>
  assert.equal(validInfrastructure(fixture), true));

test("billing preserves month-end anchor, leap days and explicit single-period receipts", () => {
  assert.equal(nextBillingDate("2027-01-31", 1), "2027-02-28");
  assert.equal(nextBillingDate("2028-01-31", 1), "2028-02-29");
  assert.equal(nextBillingDate("2028-02-29", 12), "2029-02-28");
  const h = {
    ...newHost(),
    name: "Test",
    nextDue: "2027-01-31",
    renewalAmount: 9,
    tax: 1,
  };
  const paid = recordPayment(h, "2027-01-30"),
    next = recordPayment(paid, "2027-02-27");
  assert.equal(next.nextDue, "2027-03-31");
  assert.equal(next.payments.length, 2);
  assert.equal(next.payments[0].amount, 10);
  assert.equal(h.payments.length, 0);
  assert.throws(() => nextBillingDate("2027-02-30", 1));
  assert.throws(() => nextBillingDate("9999-12-31", 1));
});
test("currencies stay separate; archived hosts and completed deadlines leave calendar and costs", () => {
  const h = {
    ...newHost(),
    name: "USD host",
    renewalAmount: 9,
    cycleMonths: 3,
    nextDue: "2026-10-04",
    purpose: "sync",
    deadlines: [
      {
        id: "deadline1",
        name: "refund",
        kind: "refund" as const,
        date: "2026-10-03",
        done: false,
      },
    ],
  };
  const data = {
    ...emptyInfrastructure(),
    hosts: [
      h,
      {
        ...newHost(),
        name: "CNY host",
        currency: "CNY",
        renewalAmount: 24,
        cycleMonths: 12,
      },
      {
        ...newHost(),
        name: "archived",
        renewalAmount: 999,
        archived: true,
        nextDue: "2026-01-01",
      },
    ],
  };
  assert.deepEqual(monthlyCosts(data), { USD: 3, CNY: 2 });
  assert.equal(hostEvents(data).length, 2);
  assert.ok(
    attention(data, "2026-10-03").some((a) => a.id.startsWith("renewal:")),
  );
  assert.equal(
    hostEvents({
      ...data,
      hosts: [
        { ...h, deadlines: h.deadlines.map((d) => ({ ...d, done: true })) },
      ],
    }).length,
    1,
  );
  assert.equal(
    eventReference(hostEvents(data)[0].id),
    eventReference(hostEvents(data)[0].id),
  );
});
test("stale, future-dated and changed-endpoint samples never appear healthy", () => {
  const now = Date.parse("2026-10-03T12:00:00Z"),
    s: Sample = {
      id: "sample",
      checkedAt: "2026-10-03T12:00:00Z",
      target: "https://example.com/health",
      source: "http",
      ok: true,
      latencyMs: 20,
      detail: "HTTP 200",
    };
  assert.equal(sampleState(s, 5, now), "ok");
  assert.equal(sampleState(s, 5, now + 16 * 60000), "stale");
  assert.equal(sampleState(s, 5, now - 6 * 60000), "stale");
  assert.equal(sampleState(undefined, 5, now), "unknown");
  assert.equal(
    latestSample(
      { ...newHost(), samples: [s], monitorUrl: "https://new.example.com" },
      "http",
    ),
    undefined,
  );
  const old = {
    ...s,
    source: "collector" as const,
    metrics: {
      sampledAt: "2026-10-01T12:00:00Z",
      cpuPercent: 1,
      memoryPercent: 2,
      diskPercent: 3,
      uptimeSeconds: 1,
      networkRxBytes: 1,
      networkTxBytes: 1,
    },
  };
  assert.equal(sampleState(old, 5, now), "stale");
});
test("infrastructure validation rejects corruption and preserves backup-shaped roundtrips", () => {
  const h = { ...newHost(), name: "Valid" },
    data = { ...emptyInfrastructure(), hosts: [h] };
  assert.equal(validInfrastructure(JSON.parse(JSON.stringify(data))), true);
  for (const change of [
    { name: "" },
    { ramGb: NaN },
    { nextDue: "2026-02-30" },
    { website: "javascript:alert(1)" },
    { currency: "usd" },
    { intervalMinutes: 1 },
    { services: [{ id: "s", name: "missing fields" }] },
  ])
    assert.equal(
      validInfrastructure({ ...data, hosts: [{ ...h, ...change }] }),
      false,
    );
  assert.equal(validInfrastructure({ ...data, hosts: [h, h] }), false);
  assert.equal(
    validReport(
      {
        id: "r",
        createdAt: new Date().toISOString(),
        summary: "x",
        observations: [],
        suggestions: [
          { title: "x", reason: "x", hostId: "invented", dueDate: "" },
        ],
      },
      [h],
    ),
    false,
  );
});
test("AI scope is opt-in and excludes addresses, paths, tokens, private logs and order IDs", () => {
  const h = {
    ...newHost(),
    name: "A",
    purpose: "sync",
    ipv4: "PRIVATE_IP",
    credentialRef: "PRIVATE_REF",
    orderId: "PRIVATE_ORDER",
    backupLocation: "PRIVATE_BACKUP",
    consoleUrl: "https://secret.example.com",
    logs: [
      { id: "l", date: "2026-10-03", kind: "incident", text: "PRIVATE_LOG" },
    ],
    services: [
      {
        id: "s",
        name: "sync",
        project: "Oceanseo",
        url: "https://private.example.com",
        port: "22",
        directory: "PRIVATE_PATH",
        database: "PRIVATE_DATABASE",
        purpose: "PRIVATE_SERVICE_NOTE",
      },
    ],
  };
  const data = { ...emptyInfrastructure(), hosts: [h] },
    raw = JSON.stringify(infrastructureContext(data));
  assert.ok(!raw.includes("PRIVATE_"));
  assert.ok(!raw.includes("secret.example.com"));
  const assistant = {
    tasks: [],
    countdowns: [],
    life: emptyLife(),
    purchases: [],
    mealPlan: null,
    work: null,
    ready: true,
    view: "infrastructure" as const,
    infrastructure: data,
  };
  assert.equal(makeContext(assistant, []).sections.infrastructure, undefined);
  assert.ok(makeContext(assistant, ["infrastructure"]).sections.infrastructure);
});
