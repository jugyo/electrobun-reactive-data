export type LiveQuerySnapshot<T> =
  | {
      status: "loading";
      data: undefined;
      error: undefined;
      updatedAt: undefined;
      refreshCount: 0;
    }
  | {
      status: "success";
      data: T;
      error: undefined;
      updatedAt: number;
      refreshCount: number;
    }
  | {
      status: "error";
      data: undefined;
      error: Error;
      updatedAt: number;
      refreshCount: number;
    };
export interface ChangeFeedHandlers {
  onNotifications(batch: { queries: string[] }): void;
  onSubscribed(queryIds: readonly string[]): void;
  onError(error: unknown): void;
}
export interface ChangeFeed {
  setQueries(queryIds: readonly string[]): void;
  start(handlers: ChangeFeedHandlers): void;
  stop(): void;
}

const stableKey = (value: unknown): string =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(stableKey).join(",")}]`
      : `{${Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`)
          .join(",")}}`;
class Mounted<P, R> {
  snapshot: LiveQuerySnapshot<R> = {
    status: "loading",
    data: undefined,
    error: undefined,
    updatedAt: undefined,
    refreshCount: 0,
  };
  listeners = new Set<() => void>();
  refreshing = false;
  dirty = false;
  disposed = false;
  constructor(
    readonly id: string,
    readonly query: (params: P) => Promise<R>,
    readonly params: P,
    readonly active: (on: boolean) => void,
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    const first = !this.listeners.size;
    this.listeners.add(listener);
    if (first) {
      this.active(true);
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.active(false);
    };
  };
  async refresh() {
    if (this.disposed) return;
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    this.refreshing = true;
    do {
      this.dirty = false;
      try {
        const data = await this.query(this.params);
        if (this.disposed || !this.listeners.size) continue;
        this.snapshot = {
          status: "success",
          data,
          error: undefined,
          updatedAt: Date.now(),
          refreshCount: (this.snapshot.refreshCount ?? 0) + 1,
        };
      } catch (cause) {
        if (this.disposed || !this.listeners.size) continue;
        this.snapshot = {
          status: "error",
          data: undefined,
          error: cause instanceof Error ? cause : new Error(String(cause)),
          updatedAt: Date.now(),
          refreshCount: (this.snapshot.refreshCount ?? 0) + 1,
        };
      }
      this.listeners.forEach((listener) => listener());
    } while (this.dirty && !this.disposed);
    this.refreshing = false;
  }
}
export class LiveQueryRuntime {
  private instances = new Map<string, Mounted<any, any>>();
  private started = false;
  private disposed = false;
  private roots = 0;
  private cleanupVersion = 0;
  constructor(private readonly feed: ChangeFeed) {}
  getInstance<P, R>(id: string, query: (params: P) => Promise<R>, params: P) {
    const key = `${id}:${stableKey(params)}`;
    let item = this.instances.get(key);
    if (!item) {
      item = new Mounted(id, query, params, (on) => this.active(key, on));
      this.instances.set(key, item);
    }
    return item as Mounted<P, R>;
  }
  stop() {
    if (this.disposed) return;
    this.disposed = true;
    this.feed.stop();
    for (const item of this.instances.values()) item.disposed = true;
    this.instances.clear();
  }
  attachRendererRoot(): () => void {
    if (this.disposed)
      throw new Error(
        "A stopped runtime cannot be restarted; create a new client",
      );
    this.roots += 1;
    const version = ++this.cleanupVersion;
    return () => {
      this.roots = Math.max(0, this.roots - 1);
      queueMicrotask(() => {
        if (!this.roots && this.cleanupVersion === version) this.stop();
      });
    };
  }
  private active(key: string, on: boolean) {
    if (this.disposed) return;
    if (!on) {
      queueMicrotask(() => {
        const item = this.instances.get(key);
        if (item && !item.listeners.size) {
          item.disposed = true;
          this.instances.delete(key);
          this.sync();
        }
      });
    } else this.sync();
  }
  private sync() {
    const ids = [
      ...new Set(
        [...this.instances.values()]
          .filter((x) => x.listeners.size)
          .map((x) => x.id),
      ),
    ].sort();
    this.feed.setQueries(ids);
    if (ids.length && !this.started) {
      this.started = true;
      this.feed.start({
        onNotifications: (b) => this.rerun(b.queries),
        onSubscribed: (ids) => this.rerun(ids),
        onError: console.error,
      });
    }
  }
  private rerun(ids: readonly string[]) {
    const set = new Set(ids);
    for (const item of this.instances.values())
      if (item.listeners.size && set.has(item.id)) void item.refresh();
  }
}
