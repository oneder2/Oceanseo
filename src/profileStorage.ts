// Each renderer is bound once, before importing business stores. Reloading a
// renderer cannot switch a native process's profile or replay another outbox.
import { OUTBOX_PREFIX } from "./reliableState";
import { mergeSharedData } from "./personal/sharedData";
const PREFIX = "oceanseo.profile.v1:";
let currentKey = "local";
let initialized = false;
let personalScene: string | undefined;
export function initializePersonalStorage(_scope: string) { personalScene = "main"; }
const sceneKey = (key: string) => !!personalScene && key !== "tideplan.tasks.v1" && key !== "tideplan.reminders.v1"
  && !key.startsWith("tideplan.draft.task:") && !key.startsWith("tideplan.draft.notebook:")
  && key !== "tideplan.notification-ledger.v2" && key !== "tideplan.last-notification.v1"
  && key !== "tideplan.autostart-initialized" && !key.startsWith("tideplan.sync")
  && !key.startsWith("oceanseo.personal.");
export function currentProfileKey() { return currentKey; }

export function initializeProfileStorage(key: string) {
  if (!(key === "local" || /^[a-f0-9]{64}$/.test(key) || /^web:[0-9a-f-]{36}$/.test(key))) throw Error("profile_key_invalid");
  if (initialized && key !== currentKey) throw Error("profile_restart_required");
  currentKey = key;
  initialized = true;
}

export class ProfileStorage implements Storage {
  constructor(private source: () => Storage, private profile: () => string) {}

  private prefix() { return this.profile() === "local" ? "" : `${PREFIX}${this.profile()}:`; }
  private names() {
    const source = this.source();
    const prefix = this.prefix();
    const names: string[] = [];
    for (let index = 0; index < source.length; index++) {
      const name = source.key(index);
      if (name !== null && (prefix ? name.startsWith(prefix) : !name.startsWith(PREFIX)))
        {
          const relative = name.slice(prefix.length);
          const scenePrefix = `oceanseo.scene.v1:${personalScene}:`;
          if (personalScene && relative.startsWith(scenePrefix)) names.push(relative.slice(scenePrefix.length));
          else if (!relative.startsWith("oceanseo.scene.v1:") && !sceneKey(relative)) names.push(relative);
          else if (!personalScene && !relative.startsWith("oceanseo.scene.v1:")) names.push(relative);
        }
    }
    return names;
  }

  get length() { return this.names().length; }
  key(index: number) { return this.names()[index] ?? null; }
  private storageKey(key: string) { return this.prefix() + (sceneKey(key) ? `oceanseo.scene.v1:${personalScene}:` : "") + key; }
  getItem(key: string) { return this.source().getItem(this.storageKey(key)); }
  setItem(key: string, value: string) { this.source().setItem(this.storageKey(key), value); }
  removeItem(key: string) { this.source().removeItem(this.storageKey(key)); }
  clear() { for (const key of this.names()) this.removeItem(key); }

  migrateSharedTools(sceneIds: string[], native: boolean) {
    const source = this.source(), prefix = this.prefix();
    const marker = `${prefix}oceanseo.personal.shared-tools.v1`;
    if (source.getItem(marker)) return;
    const before: Record<string, string> = {};
    const values = new Map<string, unknown>();
    const pending = new Map<string, unknown>();
    const extra = new Map<string, string>();
    for (const scene of ["main", ...sceneIds.filter(id => id !== "main")]) {
      const scenePrefix = `${prefix}oceanseo.scene.v1:${scene}:`;
      for (let index = 0; index < source.length; index++) {
        const name = source.key(index);
        if (!name?.startsWith(scenePrefix)) continue;
        const key = name.slice(scenePrefix.length), raw = source.getItem(name)!;
        before[name] = raw;
        if (!key.startsWith("tideplan.")) continue;
        let value: unknown;
        try { value = JSON.parse(raw); } catch (error) {
          if (key.startsWith(OUTBOX_PREFIX)) throw error;
          if (!extra.has(key)) extra.set(key, raw);
          continue;
        }
        if (key.startsWith(OUTBOX_PREFIX)) {
          const entry = value as { revision?: string; value?: unknown };
          if (typeof entry?.revision !== "string" || !Object.hasOwn(entry, "value")) throw Error("save_journal_corrupt");
          pending.set(key.slice(OUTBOX_PREFIX.length), mergeSharedData(pending.get(key.slice(OUTBOX_PREFIX.length)), entry.value));
        } else values.set(key, mergeSharedData(values.get(key), value));
      }
    }
    // Native committed state is migrated by SQLite, so local mirrors must not
    // replace it. Pending writes still merge with the canonical native snapshot.
    source.setItem(`${prefix}oceanseo.personal.recovery.before-sharing.v1`, JSON.stringify(before));
    for (const [key, raw] of extra) source.setItem(`${prefix}oceanseo.scene.v1:main:${key}`, raw);
    for (const [key, value] of values) if (!native || !/^tideplan\.(?:purchase-list|meal-plan|shopping-checked|countdowns|meal-preferences|bead-pattern|bead-works|life|assistant|goals|infrastructure)\.v1$/.test(key))
      source.setItem(`${prefix}oceanseo.scene.v1:main:${key}`, JSON.stringify(value));
    for (const [key, value] of pending) {
      const merged = native ? value : mergeSharedData(values.get(key), value, true);
      source.setItem(`${prefix}oceanseo.scene.v1:main:${OUTBOX_PREFIX}${key}`, JSON.stringify({ revision: `sharing:${Date.now()}`, value: merged, sharedMigration: true }));
      if (!native) source.setItem(`${prefix}oceanseo.scene.v1:main:${key}`, JSON.stringify(merged));
    }
    source.setItem(marker, "1");
  }

  // A full workspace restore may activate a different scene. Archive pending
  // edits from every scene in this profile before replacing native data, then
  // clear them only after success so switching later cannot replay stale data.
  preparePersonalRestore() {
    const source = this.source(), prefix = this.prefix();
    const pending: Record<string, string> = {};
    for (let index = 0; index < source.length; index++) {
      const name = source.key(index);
      if (name === null || (prefix ? !name.startsWith(prefix) : name.startsWith(PREFIX))) continue;
      const relative = name.slice(prefix.length);
      const key = relative.match(/^oceanseo\.scene\.v1:(?:main|[0-9a-f-]{36}):(.+)$/)?.[1] ?? relative;
      if (key.startsWith(OUTBOX_PREFIX) || key.startsWith("tideplan.draft.") || key === "tideplan.goals.pending.v1") {
        const raw = source.getItem(name);
        if (raw !== null) pending[name] = raw;
      }
    }
    if (Object.keys(pending).length) source.setItem(`${prefix}oceanseo.personal.recovery.before-restore:${crypto.randomUUID()}`, JSON.stringify(pending));
    return () => {
      for (const [name, raw] of Object.entries(pending)) if (source.getItem(name) === raw) source.removeItem(name);
    };
  }
}

// Lazy access preserves browser preview and test imports without a DOM.
export const profileLocalStorage = new ProfileStorage(() => globalThis.localStorage, () => currentKey);
export const profileSessionStorage = new ProfileStorage(() => globalThis.sessionStorage, () => currentKey);
