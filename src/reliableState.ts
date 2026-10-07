// Each key is a durable outbox entry. A failed database write must never make
// a subsequent startup replace the newer local value with an older snapshot.
export const OUTBOX_PREFIX = "tideplan.outbox.v1:";
let revision = 0;
function journalValue(raw: string) {
  const entry: unknown = JSON.parse(raw);
  if (
    !entry ||
    typeof entry !== "object" ||
    !("revision" in entry) ||
    typeof entry.revision !== "string" ||
    !("value" in entry) || !Object.hasOwn(entry, "value")
  )
    throw Error("save_journal_corrupt");
  return entry.value;
}
export class ReliableState {
  private pending = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private error = false;
  private locked = false;
  private localFailures = new Set<string>();
  private memory = new Map<string, string>();
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
    private keys: string[],
    private write: (key: string, value: unknown) => Promise<void>,
  ) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    this.listeners.forEach((fn) => fn());
  }
  status = () =>
    this.error || this.localFailures.size
      ? "error"
      : this.pending.size
        ? "saving"
        : this.keys.some((k) => this.storage.getItem(OUTBOX_PREFIX + k))
          ? "pending"
          : "saved";
  async persist(key: string, value: unknown) {
    if (this.locked) throw Error("restore_in_progress");
    if (!this.keys.includes(key)) throw Error("state_key_invalid");
    if (value === undefined) throw Error("state_value_invalid");
    const raw = JSON.stringify({
      revision: `${Date.now()}:${++revision}`,
      value,
    });
    this.memory.set(key, raw);
    try {
      // Journal first: even a crash between these writes is recoverable.
      this.storage.setItem(OUTBOX_PREFIX + key, raw);
      this.storage.setItem(key, JSON.stringify(value));
      this.localFailures.delete(key);
      this.memory.delete(key);
    } catch (e) {
      this.localFailures.add(key);
      this.emit();
      throw e;
    }
    return this.enqueue(key, raw);
  }
  private async enqueue(key: string, raw: string) {
    const write = (this.pending.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await this.write(key, journalValue(raw));
        if (this.storage.getItem(OUTBOX_PREFIX + key) === raw)
          this.storage.removeItem(OUTBOX_PREFIX + key);
      });
    this.pending.set(key, write);
    this.emit();
    try {
      await write;
    } catch (e) {
      this.error = true;
      throw e;
    } finally {
      if (this.pending.get(key) === write) this.pending.delete(key);
      if (
        !this.pending.size &&
        !this.keys.some((k) => this.storage.getItem(OUTBOX_PREFIX + k))
      )
        this.error = false;
      this.emit();
    }
  }
  async flush() {
    for (const [key, raw] of this.memory) {
      try {
        this.storage.setItem(OUTBOX_PREFIX + key, raw);
        this.storage.setItem(key, JSON.stringify(journalValue(raw)));
        this.localFailures.delete(key);
        this.memory.delete(key);
      } catch {
        this.emit();
        throw Error("local_storage_full");
      }
    }
    await Promise.allSettled([...this.pending.values()]);
    const results = await Promise.allSettled(
      this.keys.flatMap((key) => {
        const raw = this.storage.getItem(OUTBOX_PREFIX + key);
        return raw === null ? [] : [this.enqueue(key, raw)];
      }),
    );
    if (this.localFailures.size || results.some((r) => r.status === "rejected"))
      throw Error("state_save_failed");
    // Include changes made while the retry was running.
    if (
      this.pending.size ||
      this.keys.some((k) => this.storage.getItem(OUTBOX_PREFIX + k))
    )
      await this.flush();
  }
  async recover(state: Record<string, unknown>) {
    for (const key of this.keys) {
      const raw = this.storage.getItem(OUTBOX_PREFIX + key);
      if (raw !== null)
        this.storage.setItem(key, JSON.stringify(journalValue(raw)));
      else if (Object.hasOwn(state, key))
        this.storage.setItem(key, JSON.stringify(state[key]));
      else this.storage.removeItem(key);
    }
    // Replay errors are shown by status; consumers can still use the newer
    // local mirror. Malformed journals/mirror errors above remain fatal.
    await this.flush().catch(() => undefined);
  }
  async exclusive<T>(action: () => Promise<T>, keepLocked: boolean | ((result: T) => boolean) = false) {
    if (this.locked) throw Error("restore_in_progress");
    this.locked = true;
    let retained = false;
    try {
      await this.flush();
      const result = await action();
      retained = typeof keepLocked === "function" ? keepLocked(result) : keepLocked;
      return result;
    } finally {
      if (!retained) this.locked = false;
    }
  }
}
