import test from "node:test";
import assert from "node:assert/strict";
import { ProfileStorage, initializeProfileStorage, initializePersonalStorage } from "../src/profileStorage";
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

test("workspace restore archives every scene's pending edits without touching another profile", async () => {
  const { raw, alice, bob } = setup();
  const scene = "11111111-1111-4111-8111-111111111111";
  const outbox = `oceanseo.scene.v1:${scene}:${OUTBOX_PREFIX}tideplan.purchase-list.v1`;
  const goalPending = "oceanseo.scene.v1:main:tideplan.goals.pending.v1";
  const draft = "tideplan.draft.task:new";
  const pending = JSON.stringify({ revision: "1", value: ["newer old data"] });
  for (const store of [alice, bob]) {
    store.setItem(outbox,pending);store.setItem(goalPending,"queued proposal");store.setItem(draft,"draft");
    store.setItem("tideplan.tasks.v1","shared tasks");
  }
  const clear = alice.preparePersonalRestore();
  // Until native restore succeeds, failed restore must leave edits replayable.
  assert.equal(alice.getItem(outbox),pending);
  clear();
  assert.equal(alice.getItem(outbox),null);assert.equal(alice.getItem(goalPending),null);assert.equal(alice.getItem(draft),null);
  assert.equal(bob.getItem(outbox),pending);assert.equal(bob.getItem(goalPending),"queued proposal");assert.equal(bob.getItem(draft),"draft");
  assert.equal(alice.getItem("tideplan.tasks.v1"),"shared tasks");
  const archiveKey=Array.from({length:alice.length},(_,i)=>alice.key(i)).find(k=>k?.startsWith("oceanseo.personal.recovery.before-restore:"))!;
  const archive=JSON.parse(alice.getItem(archiveKey)!);
  assert.equal(Object.keys(archive).length,3);assert.ok(Object.values(archive).includes(pending));
  assert.equal(raw.length,6);
});

test("sharing migration preserves both scenes and merges pending edits with native committed data", async () => {
  const { raw, alice, bob } = setup();
  const scene = "11111111-1111-4111-8111-111111111111", key = "tideplan.purchase-list.v1";
  const main = `oceanseo.scene.v1:main:${key}`, other = `oceanseo.scene.v1:${scene}:${key}`;
  alice.setItem(main, JSON.stringify([{id:"a",name:"main"}]));
  alice.setItem(other, JSON.stringify([{id:"b",name:"CEO"}]));
  alice.setItem(`oceanseo.scene.v1:${scene}:${OUTBOX_PREFIX}${key}`, JSON.stringify({revision:"1",value:[{id:"b",name:"edited"}]}));
  bob.setItem(other, "other account");
  alice.migrateSharedTools(["main",scene],true);
  const writes: unknown[] = [];
  const canonical = new ProfileStorage(() => raw, () => aliceKey);
  // Use raw canonical keys before enabling the shared scene namespace globally.
  const recovery = new ReliableState({getItem:k=>canonical.getItem(`oceanseo.scene.v1:main:${k}`),setItem:(k,v)=>canonical.setItem(`oceanseo.scene.v1:main:${k}`,v),removeItem:k=>canonical.removeItem(`oceanseo.scene.v1:main:${k}`)},[key],async(_key,value)=>{writes.push(value);});
  await recovery.recover({[key]:[{id:"a",name:"native"},{id:"b",name:"old"},{id:"c",name:"database only"}]});
  assert.deepEqual(writes,[[{id:"a",name:"native"},{id:"b",name:"edited"},{id:"c",name:"database only"}]]);
  assert.equal(bob.getItem(other),"other account");
  assert.equal(alice.getItem(other),JSON.stringify([{id:"b",name:"CEO"}]));
  assert.ok(alice.getItem("oceanseo.personal.recovery.before-sharing.v1"));
  alice.migrateSharedTools(["main",scene],true);
  assert.equal(alice.getItem(`oceanseo.scene.v1:main:${OUTBOX_PREFIX}${key}`),null);
});

test("tool storage remains shared when workspace changes while profiles remain isolated", () => {
  const {alice,bob}=setup();
  initializePersonalStorage("main");
  alice.setItem("tideplan.life.v1","same data");
  initializePersonalStorage("11111111-1111-4111-8111-111111111111");
  assert.equal(alice.getItem("tideplan.life.v1"),"same data");
  assert.equal(bob.getItem("tideplan.life.v1"),null);
});
