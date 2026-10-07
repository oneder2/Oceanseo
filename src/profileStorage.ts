// Each renderer is bound once, before importing business stores. Reloading a
// renderer cannot switch a native process's profile or replay another outbox.
const PREFIX = "oceanseo.profile.v1:";
let currentKey = "local";
let initialized = false;
export function currentProfileKey() { return currentKey; }

export function initializeProfileStorage(key: string) {
  if (!(key === "local" || /^[a-f0-9]{64}$/.test(key))) throw Error("profile_key_invalid");
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
        names.push(name.slice(prefix.length));
    }
    return names;
  }

  get length() { return this.names().length; }
  key(index: number) { return this.names()[index] ?? null; }
  getItem(key: string) { return this.source().getItem(this.prefix() + key); }
  setItem(key: string, value: string) { this.source().setItem(this.prefix() + key, value); }
  removeItem(key: string) { this.source().removeItem(this.prefix() + key); }
  clear() { for (const key of this.names()) this.removeItem(key); }
}

// Lazy access preserves browser preview and test imports without a DOM.
export const profileLocalStorage = new ProfileStorage(() => globalThis.localStorage, () => currentKey);
export const profileSessionStorage = new ProfileStorage(() => globalThis.sessionStorage, () => currentKey);
