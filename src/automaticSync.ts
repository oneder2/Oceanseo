import type { SyncPlan } from "./syncStore";

export type SyncPause = "auth" | "conflict" | "integrity" | "firstConnection";
export interface AutomaticSyncSettings {
  version: number;
  profileKey: string;
  enabled: boolean;
  pause: SyncPause | null;
  message: string | null;
}
export interface AutomaticCheck {
  state: "disabled" | "paused" | "deferred" | "unchanged" | "ready";
  settings: AutomaticSyncSettings;
  plan: SyncPlan | null;
}
export interface SyncReceipt { changed: boolean; revision: number; snapshotPath: string | null }
interface CommitDependencies {
  gate: (action: () => Promise<SyncReceipt>, keepLocked: (receipt: SyncReceipt) => boolean) => Promise<SyncReceipt>;
  commit: () => Promise<SyncReceipt>;
  freeze: (busy: boolean) => void;
  beforeReload: () => void;
  reload: () => void;
}

// A received snapshot makes every mounted consumer stale. Retain the data gate
// before attempting navigation, even if remembering the view or reload fails.
export async function applyAutomaticSync(deps: CommitDependencies) {
  deps.freeze(true);
  let received = false;
  try {
    const receipt = await deps.gate(deps.commit, result => result.changed);
    received = receipt.changed;
    if (received) {
      deps.beforeReload();
      deps.reload();
    }
    return receipt;
  } finally {
    if (!received) deps.freeze(false);
  }
}
export interface AutomaticSyncStatus {
  state: "off" | "waiting" | "checking" | "syncing" | "synced" | "retry" | "paused";
  message: string;
  retryAt: number | null;
}
export function syncFailure(error: unknown): { kind: string; message: string } {
  if (error && typeof error === "object" && "kind" in error && "message" in error)
    return { kind: String(error.kind), message: String(error.message) };
  return { kind: "integrity", message: error instanceof Error ? error.message : String(error) };
}

interface Dependencies {
  canCheck: () => boolean;
  canCommit: () => boolean;
  check: () => Promise<AutomaticCheck>;
  commit: (plan: SyncPlan) => Promise<SyncReceipt | null>;
  status: (status: AutomaticSyncStatus) => void;
  settings: (settings: AutomaticSyncSettings) => void;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, delay: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

// One foreground scheduler per immutable native profile. Preview and commit are
// separate: interaction starting during the HTTP check must prevent application.
export class AutomaticSyncScheduler {
  private settings: AutomaticSyncSettings | null = null;
  private timer: unknown;
  private disposed = false;
  private running = false;
  private generation = 0;
  private failures = 0;
  private retryAt = 0;
  private wakeAfterRun = false;
  private readonly now;
  constructor(private profileKey: string, private deps: Dependencies) {
    this.now = deps.now ?? Date.now;
  }
  private publish(state: AutomaticSyncStatus["state"], message = "", retryAt: number | null = null) {
    if (!this.disposed) this.deps.status({ state, message, retryAt });
  }
  private clearTimer() {
    if (this.timer !== undefined) {
      if (this.deps.clearTimer) this.deps.clearTimer(this.timer);
      else clearTimeout(this.timer as ReturnType<typeof setTimeout>);
      this.timer = undefined;
    }
  }
  private active() { return !this.disposed && !!this.settings?.enabled && !this.settings.pause; }
  configure(settings: AutomaticSyncSettings) {
    if (this.disposed) return;
    this.generation++;
    this.clearTimer();
    if (settings.profileKey !== this.profileKey || settings.version !== 1) {
      this.settings = null;
      this.publish("paused", "自动同步配置与当前资料库不匹配");
      return;
    }
    this.settings = settings;
    this.failures = 0;
    this.retryAt = 0;
    this.deps.settings(settings);
    if (!settings.enabled) this.publish("off");
    else if (settings.pause) this.publish("paused", settings.message ?? "同步需要处理");
    else { this.publish("waiting"); this.request(); }
  }
  suspend(message: string) {
    this.generation++;
    this.clearTimer();
    this.settings = null;
    this.publish("paused", message);
  }
  request(delay = 4000) {
    if (!this.active()) return;
    if (this.running) { this.wakeAfterRun = true; return; }
    this.clearTimer();
    const wait = Math.max(delay, this.retryAt - this.now());
    const fn = () => { this.timer = undefined; void this.run(); };
    this.timer = this.deps.setTimer ? this.deps.setTimer(fn, wait) : setTimeout(fn, wait);
  }
  async run() {
    if (!this.active() || this.running) return;
    this.clearTimer();
    if (this.retryAt > this.now()) { this.request(this.retryAt - this.now()); return; }
    if (!this.deps.canCheck()) { this.request(8000); return; }
    this.running = true;
    this.wakeAfterRun = false;
    const generation = this.generation;
    const current = () => generation === this.generation && this.active();
    let delay = 60000;
    try {
      this.publish("checking");
      const check = await this.deps.check();
      if (!current()) return;
      if (check.settings.profileKey !== this.profileKey || check.settings.version !== 1)
        throw { kind: "integrity", message: "同步响应与当前资料库不匹配" };
      this.settings = check.settings;
      this.deps.settings(check.settings);
      if (check.state === "disabled" || !check.settings.enabled) { this.publish("off"); return; }
      if (check.state === "paused" || check.settings.pause) {
        this.publish("paused", check.settings.message ?? "同步需要处理");
        return;
      }
      if (check.state === "deferred" || !this.deps.canCheck()) {
        this.publish("waiting", "等待当前操作完成"); delay = 8000; return;
      }
      if (check.state === "ready") {
        if (!check.plan || check.plan.conflicts.length)
          throw { kind: "integrity", message: "有内容需要确认，已保留两份记录" };
        if (!this.deps.canCommit()) {
          this.publish("waiting", "等待编辑和保存完成"); delay = 8000; return;
        }
        this.publish("syncing");
        const receipt = await this.deps.commit(check.plan);
        if (!current()) return;
        if (!receipt) { this.publish("waiting", "等待当前操作完成"); delay = 8000; return; }
      }
      this.failures = 0;
      this.retryAt = 0;
      this.publish("synced");
    } catch (error) {
      if (!current()) return;
      const failure = syncFailure(error);
      if (failure.kind === "network" || failure.kind === "stale") {
        delay = failure.kind === "stale" ? 5000 : Math.min(300000,
          5000 * 2 ** Math.min(this.failures++, 6) * (1 + (this.deps.random ?? Math.random)() * 0.2));
        this.retryAt = this.now() + delay;
        this.publish("retry", failure.message, this.retryAt);
      } else {
        this.settings = { ...this.settings!, pause: failure.kind === "auth" ? "auth" : "integrity", message: failure.message };
        this.deps.settings(this.settings);
        this.publish("paused", failure.message);
      }
    } finally {
      this.running = false;
      if (this.active()) this.request(this.wakeAfterRun ? Math.min(delay, 4000) : delay);
    }
  }
  dispose() { this.disposed = true; this.generation++; this.clearTimer(); }
}
