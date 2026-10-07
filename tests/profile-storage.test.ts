import test from "node:test";
import assert from "node:assert/strict";
import { ProfileStorage, initializeProfileStorage } from "../src/profileStorage";
import { ReliableState, OUTBOX_PREFIX } from "../src/reliableState";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

const aliceKey = "a".repeat(64), bobKey = "b".repeat(64);
function setup() {
  const raw = new MemoryStorage();
  return { raw, local: new ProfileStorage(() => raw, () => "local"),
    alice: new ProfileStorage(() => raw, () => aliceKey), bob: new ProfileStorage(() => raw, () => bobKey) };
}

test("new accounts never inherit legacy records, drafts, AI conversation or pending requests", () => {
  const { raw, local, alice, bob } = setup();
  const keys = ["tideplan.tasks.v1", "tideplan.goals.pending.v1", "tideplan.draft.task.1",
    "tideplan.goals.v1", "tideplan.life.v1", OUTBOX_PREFIX + "tideplan.life.v1"];
  for (const key of keys) local.setItem(key, "original-offline");
  for (const key of keys) {
    assert.equal(alice.getItem(key), null);
    alice.setItem(key, "alice-only");
    assert.equal(bob.getItem(key), null);
    bob.setItem(key, "bob-only");
    assert.equal(local.getItem(key), "original-offline");
    assert.equal(alice.getItem(key), "alice-only");
    assert.equal(bob.getItem(key), "bob-only");
  }
  assert.equal(raw.length, keys.length * 3);
  assert.equal(local.length, keys.length);
  assert.equal(alice.length, keys.length);
  assert.equal(bob.length, keys.length);
});

test("draft cleanup and clear are scoped and preserve another user's draft", () => {
  const { local, alice, bob } = setup();
  for (const store of [local, alice, bob]) {
    store.setItem("tideplan.draft.task.1", "draft");
    store.setItem("tideplan.tasks.v1", "data");
  }
  const keys = Array.from({ length: alice.length }, (_, i) => alice.key(i));
  for (const key of keys) if (key?.startsWith("tideplan.draft.")) alice.removeItem(key);
  assert.equal(alice.getItem("tideplan.draft.task.1"), null);
  assert.equal(bob.getItem("tideplan.draft.task.1"), "draft");
  assert.equal(local.getItem("tideplan.draft.task.1"), "draft");
  alice.clear();
  assert.equal(alice.length, 0);
  assert.equal(bob.length, 2);
  assert.equal(local.length, 2);
  assert.equal(alice.key(0), null);
});

test("failed writes replay only in the original account, never the next account", async () => {
  const { local, alice, bob } = setup();
  const key = "tideplan.life.v1";
  const failing = new ReliableState(alice, [key], () => Promise.reject(Error("offline")));
  await assert.rejects(failing.persist(key, { owner: "alice" }));
  assert.ok(alice.getItem(OUTBOX_PREFIX + key));
  const writes: unknown[] = [];
  const second = new ReliableState(bob, [key], async (_key, value) => { writes.push(value); });
  await second.recover({});
  assert.deepEqual(writes, []);
  assert.equal(bob.getItem(key), null);
  assert.equal(local.getItem(key), null);
  const recovered = new ReliableState(alice, [key], async (_key, value) => { writes.push(value); });
  await recovered.recover({});
  assert.deepEqual(writes, [{ owner: "alice" }]);
  assert.equal(alice.getItem(OUTBOX_PREFIX + key), null);
});

test("profile binding rejects traversal and hot switching instead of retargeting queued writes", () => {
  assert.throws(() => initializeProfileStorage("../../another"), /profile_key_invalid/);
  initializeProfileStorage("local");
  initializeProfileStorage("local");
  assert.throws(() => initializeProfileStorage(aliceKey), /profile_restart_required/);
});
