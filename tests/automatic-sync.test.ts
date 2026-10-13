import test from "node:test";
import assert from "node:assert/strict";
import { applyAutomaticSync, AutomaticSyncScheduler, type AutomaticCheck, type AutomaticSyncSettings, type AutomaticSyncStatus } from "../src/automaticSync";
import { ReliableState } from "../src/reliableState";
import { rememberSyncView, takeSyncView } from "../src/syncView";

const key = "a".repeat(64);
const prefs = (enabled = true): AutomaticSyncSettings => ({ version: 1, profileKey: key, enabled, pause: null, message: null });
const ready = (): AutomaticCheck => ({ state: "ready", settings: prefs(), plan: {
  previewId: "p", uploadCount: 1, downloadCount: 0, conflicts: [], firstConnection: false, changes: [],
} });
function setup() {
  let now = 0, checking = true, committing = true;
  const timers = new Map<number, { delay: number; fn: () => void }>();
  let seq = 0, calls = 0, commits = 0;
  const statuses: AutomaticSyncStatus[] = [], settings: AutomaticSyncSettings[] = [];
  let check: () => Promise<AutomaticCheck> = async () => ready();
  let commit = async () => ({ changed: false, revision: 2, snapshotPath: null });
  const scheduler = new AutomaticSyncScheduler(key, {
    now: () => now, random: () => 0, canCheck: () => checking, canCommit: () => committing,
    setTimer: (fn, delay) => { timers.set(++seq, { fn, delay }); return seq; }, clearTimer: id => { timers.delete(id as number); },
    check: async () => { calls++; return check(); }, commit: async () => { commits++; return commit(); },
    status: s => statuses.push(s), settings: s => settings.push(s),
  });
  return { scheduler, timers, statuses, settings,
    counts: () => ({ calls, commits }), advance: (ms: number) => { now += ms; },
    canCheck: (value: boolean) => { checking = value; }, canCommit: (value: boolean) => { committing = value; },
    check: (fn: typeof check) => { check = fn; }, commit: (fn: typeof commit) => { commit = fn; },
  };
}
test("automatic sync defaults off and rejects foreign profile settings", async () => {
  const s = setup();
  await s.scheduler.run();
  s.scheduler.configure(prefs(false)); s.scheduler.request(); await s.scheduler.run();
  assert.deepEqual(s.counts(), { calls: 0, commits: 0 });
  assert.equal(s.timers.size, 0);
  s.scheduler.configure({ ...prefs(), profileKey: "b".repeat(64) });
  await s.scheduler.run();
  assert.equal(s.statuses.at(-1)?.state, "paused");
  assert.deepEqual(s.counts(), { calls: 0, commits: 0 });
});
test("save bursts coalesce, unchanged checks never commit, periodic polling is bounded", async () => {
  const s = setup(); s.scheduler.configure(prefs());
  for (let i = 0; i < 20; i++) s.scheduler.request();
  assert.equal(s.timers.size, 1);
  assert.equal([...s.timers.values()][0].delay, 4000);
  s.check(async () => ({ state: "unchanged", settings: prefs(), plan: null }));
  await s.scheduler.run();
  assert.equal(s.counts().commits, 0);
  assert.equal(s.statuses.at(-1)?.state, "synced");
  assert.equal([...s.timers.values()][0].delay, 60000);
});
test("hidden or saving defers checks; editing starting during HTTP defers commit", async () => {
  const s = setup(); s.scheduler.configure(prefs()); s.canCheck(false);
  await s.scheduler.run(); assert.equal(s.counts().calls, 0);
  s.canCheck(true);
  let resolve!: (value: AutomaticCheck) => void;
  s.check(() => new Promise(r => { resolve = r; }));
  const run = s.scheduler.run();
  s.canCommit(false); resolve(ready()); await run;
  assert.equal(s.counts().commits, 0);
  assert.equal(s.statuses.at(-1)?.state, "waiting");
  assert.equal([...s.timers.values()][0].delay, 8000);
});
test("network retries back off and save notifications cannot bypass retry deadline", async () => {
  const s = setup(); s.scheduler.configure(prefs());
  s.check(async () => { throw { kind: "network", message: "offline" }; });
  for (const expected of [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]) {
    await s.scheduler.run();
    assert.equal([...s.timers.values()][0].delay, expected);
    const before = s.counts().calls;
    s.scheduler.request(0); await s.scheduler.run();
    assert.equal(s.counts().calls, before);
    s.advance(expected);
  }
  assert.equal(s.statuses.at(-1)?.state, "retry");
  assert.ok(s.settings.at(-1)?.enabled);
});
test("auth and integrity errors pause; conflict checks require explicit manual recovery", async () => {
  for (const kind of ["auth", "integrity"]) {
    const s = setup(); s.scheduler.configure(prefs());
    s.check(async () => { throw { kind, message: kind }; });
    await s.scheduler.run();
    assert.equal(s.statuses.at(-1)?.state, "paused");
    assert.equal(s.timers.size, 0);
    const before = s.counts(); s.scheduler.request(); await s.scheduler.run();
    assert.deepEqual(s.counts(), before);
  }
  const s = setup(); s.scheduler.configure(prefs());
  s.check(async () => ({ state: "paused", settings: { ...prefs(), pause: "conflict", message: "choose" }, plan: null }));
  await s.scheduler.run(); assert.equal(s.counts().commits, 0); assert.equal(s.timers.size, 0);
  s.check(async () => ready()); s.scheduler.configure(prefs()); await s.scheduler.run();
  assert.equal(s.counts().commits, 1);
});
test("account first connection runs automatically but unresolved conflicts never commit", async () => {
  const first = setup(); first.scheduler.configure(prefs());
  first.check(async () => ({ ...ready(), plan: { ...ready().plan!, firstConnection: true } }));
  await first.scheduler.run(); assert.equal(first.counts().commits, 1);
  for (const plan of [{ ...ready().plan!, conflicts: [{ key: "task:1", local: null, remote: null }] }]) {
    const s = setup(); s.scheduler.configure(prefs()); s.check(async () => ({ ...ready(), plan }));
    await s.scheduler.run(); assert.equal(s.counts().commits, 0); assert.equal(s.statuses.at(-1)?.state, "paused");
  }
});
test("disable or dispose while check is in flight cannot commit or publish a stale result", async () => {
  for (const dispose of [false, true]) {
    const s = setup(); s.scheduler.configure(prefs());
    let resolve!: (value: AutomaticCheck) => void;
    s.check(() => new Promise(r => { resolve = r; }));
    const run = s.scheduler.run();
    if (dispose) s.scheduler.dispose(); else s.scheduler.configure(prefs(false));
    const before = s.statuses.length;
    resolve(ready()); await run;
    assert.equal(s.counts().commits, 0); assert.equal(s.statuses.length, before); assert.equal(s.timers.size, 0);
  }
});
test("stale commit retries without permanent pause and single-flight prevents duplicate commit", async () => {
  const s = setup(); s.scheduler.configure(prefs());
  let resolve!: () => void;
  s.commit(() => new Promise(r => { resolve = () => r({ changed: false, revision: 2, snapshotPath: null }); }));
  const first = s.scheduler.run();
  await Promise.resolve(); await Promise.resolve();
  await s.scheduler.run(); s.scheduler.request(); resolve(); await first;
  assert.equal(s.counts().commits, 1);
  s.commit(async () => { throw { kind: "stale", message: "new edit" }; });
  await s.scheduler.run(); assert.equal(s.statuses.at(-1)?.state, "retry");
  assert.equal(s.settings.at(-1)?.pause, null);
});
test("policy revocation retains queued edits and resumes automatically after permission returns", async () => {
  for (const failure of ["module_permission_denied:tasks:write", {kind:"stale",message:"module_permission_denied:goals:write"}]) {
    const s=setup();s.scheduler.configure(prefs());
    s.commit(async()=>{throw failure});
    await s.scheduler.run();
    assert.equal(s.statuses.at(-1)?.state,"retry");
    assert.equal(s.settings.at(-1)?.pause,null);
    s.canCheck(false);s.advance(5000);await s.scheduler.run();
    assert.equal(s.counts().commits,1);
    s.canCheck(true);s.commit(async()=>({changed:false,revision:2,snapshotPath:null}));
    s.advance(8000);await s.scheduler.run();
    assert.equal(s.counts().commits,2);
    assert.equal(s.statuses.at(-1)?.state,"synced");
    assert.equal(s.settings.at(-1)?.pause,null);
    s.scheduler.dispose();
  }
});
test("reload view is one-shot and validates arbitrary storage contents", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  rememberSyncView(storage, "calendar"); assert.equal(takeSyncView(storage), "calendar");
  assert.equal(takeSyncView(storage), "overview");
  for (const oldRoute of ["bead-home", "bead-progress"]) {
    storage.setItem("oceanseo.sync-return-view.v1", oldRoute);
    assert.equal(takeSyncView(storage), "bead-studio");
  }
  storage.setItem("oceanseo.sync-return-view.v1", "__proto__"); assert.equal(takeSyncView(storage), "overview");
});
test("received data retains write and interaction gates before reload, including failed navigation", async () => {
  for (const failure of [null, "view", "reload"]) {
    const store = new ReliableState({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, ["x"], async () => {});
    const frozen: boolean[] = [];
    let reloads = 0;
    const commit = applyAutomaticSync({
      gate: (action, retain) => store.exclusive(action, retain),
      commit: async () => ({ changed: true, revision: 2, snapshotPath: "backup" }),
      freeze: busy => frozen.push(busy),
      beforeReload: () => { if (failure === "view") throw Error("storage unavailable"); },
      reload: () => { reloads++; if (failure === "reload") throw Error("navigation failed"); },
    });
    if (failure) await assert.rejects(commit); else await commit;
    assert.deepEqual(frozen, [true]);
    assert.equal(reloads, failure === "view" ? 0 : 1);
    await assert.rejects(store.persist("x", "stale UI"), /restore_in_progress/);
    await assert.rejects(store.exclusive(async () => {}), /restore_in_progress/);
  }
});
test("upload-only receipts and failed commits release gates without reloading", async () => {
  for (const fails of [false, true]) {
    const store = new ReliableState({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, ["x"], async () => {});
    const frozen: boolean[] = [];
    const commit = applyAutomaticSync({
      gate: (action, retain) => store.exclusive(action, retain),
      commit: async () => { if (fails) throw Error("offline"); return { changed: false, revision: 2, snapshotPath: null }; },
      freeze: busy => frozen.push(busy), beforeReload: () => assert.fail("must not reload"), reload: () => assert.fail("must not reload"),
    });
    if (fails) await assert.rejects(commit); else await commit;
    assert.deepEqual(frozen, [true, false]);
    await store.persist("x", "new edit");
  }
});
