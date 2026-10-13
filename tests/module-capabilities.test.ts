import test from "node:test";
import assert from "node:assert/strict";
import { changedStateModules, initializeCapabilities, capabilitySnapshot, canView, requireStateWrite, projectLife, canShareHistory, type CapabilityStatus } from "../src/modules/capabilities";
import { ReliableState, OUTBOX_PREFIX } from "../src/reliableState";
import { moduleCatalog } from "../src/modules/catalog";

test("mixed life documents authorize edits and deletions without sharing module permission", () => {
  const before = { version: 1, people: [{ id: "p" }], training: [], workouts: [], trips: [] };
  assert.deepEqual(changedStateModules("tideplan.life.v1", before, { ...before, trips: [{ id: "t" }] }), ["travel"]);
  assert.deepEqual(changedStateModules("tideplan.life.v1", before, undefined), ["people"]);
  assert.deepEqual(changedStateModules("tideplan.life.v1", undefined, { ...before, people: [] }), []);
  assert.throws(() => changedStateModules("tideplan.life.v1", before, { ...before, undocumented: 1 }));
  assert.throws(() => changedStateModules("undocumented", undefined, 1));
});

test("denied writes never alter the local mirror or durable outbox; projections keep originals", async () => {
  const original = capabilitySnapshot();
  const descriptors = Object.fromEntries(["window", "isTauri"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let status: CapabilityStatus = { ...original, source: "verified", modules: Object.fromEntries(Object.keys(moduleCatalog).map(id => [id, { visible: true, read: true, write: true, ai: true }])) as CapabilityStatus["modules"] };
  status.modules.people = { visible: false, read: false, write: false, ai: false };
  status.modules.travel = { visible: true, read: true, write: false, ai: false };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: { invoke: async () => status } } });
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  try {
    await initializeCapabilities();
    assert.equal(canView("people"), false); assert.equal(canView("travel"), true); assert.equal(canShareHistory(), false);
    assert.equal(canView("constructor" as never), false);
    const originalLife = { version: 1, people: [{ id: "private" }], training: [], workouts: [], trips: [{ id: "trip" }] };
    const visible = projectLife(originalLife);
    assert.deepEqual(visible.people, []); assert.equal(originalLife.people[0].id, "private"); assert.equal(visible.trips[0].id, "trip");
    const key = "tideplan.life.v1", values = new Map([[key, JSON.stringify(originalLife)]]), writes: unknown[] = [];
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const persistence = new ReliableState(storage, [key], async (_key, value) => { writes.push(value); }, requireStateWrite);
    await assert.rejects(persistence.persist(key, { ...originalLife, trips: [] }), /暂不允许/);
    assert.equal(storage.getItem(key), JSON.stringify(originalLife)); assert.equal(storage.getItem(OUTBOX_PREFIX + key), null); assert.deepEqual(writes, []);
    await persistence.persist(key, { ...originalLife, training: [{ id: "plan" }] });
    assert.equal(writes.length, 1); assert.equal(storage.getItem(OUTBOX_PREFIX + key), null);
    status = original; await initializeCapabilities();
  } finally {
    status = original; await initializeCapabilities();
    for (const key of ["window", "isTauri"]) { if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]!); else Reflect.deleteProperty(globalThis, key); }
  }
});
