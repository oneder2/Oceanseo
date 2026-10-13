import test from "node:test";
import assert from "node:assert/strict";
import { ReliableState, OUTBOX_PREFIX } from "../src/reliableState";
import { dueReminder } from "../src/reminderPolicy";
import { encodeDraft, decodeDraft } from "../src/drafts";
import { reminderBody } from "../src/useDailyReminders";
import { dateKey } from "../src/dateUtils";
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}
test("failed writes survive restart and override a stale database mirror", async () => {
  const storage = memory();
  const first = new ReliableState(storage, ["life"], async () => {
    throw Error("disk offline");
  });
  await assert.rejects(first.persist("life", { name: "new" }));
  assert.equal(first.status(), "error");
  let database: unknown;
  const restarted = new ReliableState(
    storage,
    ["life"],
    async (_key, value) => {
      database = value;
    },
  );
  await restarted.recover({ life: { name: "old" } });
  assert.deepEqual(database, { name: "new" });
  assert.equal(storage.getItem("life"), '{"name":"new"}');
  assert.equal(storage.getItem(OUTBOX_PREFIX + "life"), null);
  assert.equal(restarted.status(), "saved");
});
test("unchanged renderer flush preserves a newer native commit while real edits still save", async () => {
  const storage = memory();
  let database: unknown;
  const store = new ReliableState(storage, ["works"], async (_key, value) => { database = value; });
  await store.persist("works", { title: "Renderer snapshot" });
  database = { title: "Newer native operation" };
  await store.persist("works", { title: "Renderer snapshot" });
  await store.flush();
  assert.deepEqual(database, { title: "Newer native operation" });
  await store.persist("works", { title: "Actual user edit" });
  assert.deepEqual(database, { title: "Actual user edit" });
});
test("equal values with a failed journal retry instead of being treated as unchanged", async () => {
  const storage = memory();
  let failing = true, saved: unknown;
  const store = new ReliableState(storage, ["works"], async (_key, value) => {
    if (failing) throw Error("disk offline");
    saved = value;
  });
  await assert.rejects(store.persist("works", { title: "Keep pending" }));
  failing = false;
  await store.persist("works", { title: "Keep pending" });
  assert.deepEqual(saved, { title: "Keep pending" });
  assert.equal(store.status(), "saved");
  assert.equal(storage.getItem(OUTBOX_PREFIX + "works"), null);
});
test("an older acknowledgement cannot clear a newer queued edit", async () => {
  const storage = memory();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const seen: unknown[] = [];
  const store = new ReliableState(storage, ["x"], async (_key, v) => {
    seen.push(v);
    if (v === 1) await gate;
  });
  const one = store.persist("x", 1),
    two = store.persist("x", 2);
  assert.equal(JSON.parse(storage.getItem(OUTBOX_PREFIX + "x")!).value, 2);
  finish();
  await Promise.all([one, two]);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(storage.getItem("x"), "2");
});
test("A→B→A edits retain the last journal even when earlier equal values are acknowledged", async () => {
  const storage = memory();
  let calls = 0;
  const store = new ReliableState(storage, ["x"], async () => {
    if (++calls === 3) throw Error("last write failed");
  });
  await Promise.allSettled([
    store.persist("x", "A"),
    store.persist("x", "B"),
    store.persist("x", "A"),
  ]);
  assert.equal(JSON.parse(storage.getItem(OUTBOX_PREFIX + "x")!).value, "A");
  await store.flush();
  assert.equal(storage.getItem(OUTBOX_PREFIX + "x"), null);
});
test("backup flush retries failures and exclusive restore rejects racing writes", async () => {
  const storage = memory();
  let fails = true;
  const store = new ReliableState(storage, ["x"], async () => {
    if (fails) throw Error("full");
  });
  await assert.rejects(store.persist("x", 3));
  await assert.rejects(
    store.exclusive(async () => {
      assert.fail("must not restore after failed flush");
    }),
  );
  fails = false;
  await store.flush();
  await store.exclusive(async () => {
    await assert.rejects(store.persist("x", 4), /restore_in_progress/);
  });
  await store.persist("x", 5);
  await store.exclusive(async () => {}, true);
  await assert.rejects(store.persist("x", 6), /restore_in_progress/);
});
test("storage quota failures retain retryable values in the live session", async () => {
  const storage = memory();
  let full = true;
  const guarded = {
    ...storage,
    setItem: (k: string, v: string) => {
      if (full) throw Error("quota");
      storage.setItem(k, v);
    },
  };
  let saved: unknown;
  const store = new ReliableState(guarded, ["x"], async (_k, v) => {
    saved = v;
  });
  await assert.rejects(store.persist("x", "draft"));
  full = false;
  await store.flush();
  assert.equal(saved, "draft");
  assert.equal(store.status(), "saved");
});
test("upload-only synchronization releases the write gate and concurrent owners cannot unlock it", async () => {
  const store = new ReliableState(memory(), ["x"], async () => {});
  await store.exclusive(async () => ({ changed: false }), result => result.changed);
  await store.persist("x", 1);
  let finish!: () => void;
  const first = store.exclusive(() => new Promise<{ changed: boolean }>(r => { finish = () => r({ changed: true }); }), result => result.changed);
  await Promise.resolve(); await Promise.resolve();
  await assert.rejects(store.exclusive(async () => {}), /restore_in_progress/);
  await assert.rejects(store.persist("x", 2), /restore_in_progress/);
  finish(); await first;
  await assert.rejects(store.persist("x", 3), /restore_in_progress/);
});
test("draft round trips preserve unfinished sets instead of converting them to zero", () => {
  const result = decodeDraft(
    encodeDraft({ actual: { squat: [12, NaN, 0] }, notes: "未完成" }),
  ) as { actual: { squat: number[] } };
  assert.equal(result.actual.squat[0], 12);
  assert.ok(Number.isNaN(result.actual.squat[1]));
  assert.equal(result.actual.squat[2], 0);
});
test("corrupt recovery journals stop loading instead of replacing live data with defaults", async () => {
  const storage = memory();
  storage.setItem("x", '"keep"');
  storage.setItem(OUTBOX_PREFIX + "x", "{}");
  const store = new ReliableState(storage, ["x"], async () => {
    assert.fail("corrupt data must not reach database");
  });
  await assert.rejects(store.recover({ x: "old" }), /save_journal_corrupt/);
  assert.equal(storage.getItem("x"), '"keep"');
});
test("reminders catch up within two hours, deduplicate and ignore stale/invalid slots", () => {
  const now = new Date(2026, 8, 16, 10, 0);
  assert.equal(
    dueReminder(now, ["09:00", "19:00"], [])?.key,
    "2026-09-16-09:00",
  );
  assert.equal(
    dueReminder(now, ["09:00", "19:00"], ["2026-09-16-09:00"]),
    null,
  );
  assert.equal(dueReminder(new Date(2026, 8, 16, 11, 1), ["09:00"], []), null);
  assert.equal(
    dueReminder(new Date(2026, 8, 17, 0, 30), ["23:30"], [])?.key,
    "2026-09-16-23:30",
  );
  assert.equal(dueReminder(now, ["99:00", "no"], []), null);
});
test("reminder schedule follows local dates across daylight-saving transitions", () => {
  const before = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    for (const [month, day] of [
      [2, 8],
      [10, 1],
    ]) {
      const now = new Date(2026, month, day, 9, 30);
      assert.equal(
        dueReminder(now, ["09:00", "19:00"], [])?.key,
        `${dateKey(now)}-09:00`,
      );
    }
  } finally {
    if (before) process.env.TZ = before;
    else delete process.env.TZ;
  }
});
test("daily summary includes unfinished training and travel but excludes completed training", () => {
  const events = [
    {
      id: "a",
      targetId: "a",
      date: dateKey(),
      title: "训练",
      kind: "training" as const,
      done: false,
    },
    {
      id: "b",
      targetId: "b",
      date: dateKey(),
      title: "已完成",
      kind: "training" as const,
      done: true,
    },
    {
      id: "c",
      targetId: "c",
      date: dateKey(),
      title: "旅行",
      kind: "travel" as const,
    },
  ];
  assert.match(
    reminderBody([], [], 0, events),
    /1 项训练待清点，1 项今日旅行安排/,
  );
});
