import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { assertWireValue } from "../protocol.js";
import type { ApiDefinition } from "./api.js";
import { SessionHub } from "./hub.js";
import {
  consumeChanges,
  reconcileTriggers,
  type TriggerDefinition,
} from "./sqlite.js";

let activeOwner = false;

export interface DataOwnerOptions<A extends ApiDefinition> {
  databasePath: string;
  createApi(db: Database): A;
  triggers: readonly TriggerDefinition[];
  pollIntervalMs?: number;
  onPostCommitError?: (error: unknown) => void;
  openDatabase?: (path: string) => Database;
  makeDirectory?: (path: string) => void;
}

export function createDataOwner<A extends ApiDefinition>(
  options: DataOwnerOptions<A>,
) {
  if (activeOwner)
    throw new Error("Only one reactive data owner may exist in this process");
  activeOwner = true;
  let db: Database | undefined;
  try {
    (options.makeDirectory ?? ((path) => mkdirSync(path, { recursive: true })))(
      dirname(options.databasePath),
    );
    db =
      options.openDatabase?.(options.databasePath) ??
      new Database(options.databasePath, { create: true, strict: true });
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
    const api = options.createApi(db);
    validateApi(api);
    reconcileTriggers(db, options.triggers);

    let state: "running" | "stopping" | "stopped" = "running";
    let admitted = 0;
    let drainResolve: (() => void) | undefined;
    let stopPromise: Promise<void> | undefined;
    let closed = false;
    let hub!: SessionHub;

    const mutate = (run: () => unknown): unknown => {
      if (state !== "running") throw new Error("Reactive data is stopping");
      admitted += 1;
      let began = false;
      let committed = false;
      let result: unknown;
      try {
        db!.exec("BEGIN IMMEDIATE");
        began = true;
        result = run();
        if (result && typeof (result as { then?: unknown }).then === "function")
          throw new Error("Async handlers are not supported");
        assertWireValue(result);
        db!.exec("COMMIT");
        committed = true;
      } catch (error) {
        if (began && !committed) {
          try {
            db!.exec("ROLLBACK");
          } catch {
            /* preserve the original transaction error */
          }
        }
        throw error;
      } finally {
        admitted -= 1;
        if (!admitted) drainResolve?.();
      }
      try {
        const changes = consumeChanges(db!);
        if (changes.length) hub.notify(changes);
      } catch (error) {
        (options.onPostCommitError ?? console.error)(error);
      }
      return result;
    };

    hub = new SessionHub(api, mutate);
    const timer = setInterval(() => {
      if (state !== "running") return;
      try {
        const changes = consumeChanges(db!);
        if (changes.length) hub.notify(changes);
      } catch (error) {
        (options.onPostCommitError ?? console.error)(error);
      }
    }, options.pollIntervalMs ?? 100);

    const stop = (): Promise<void> => {
      if (stopPromise) return stopPromise;
      state = "stopping";
      hub.stop();
      clearInterval(timer);
      stopPromise = (async () => {
        if (admitted)
          await new Promise<void>((resolve) => {
            drainResolve = resolve;
          });
        if (!closed) {
          closed = true;
          db!.close();
        }
        state = "stopped";
        activeOwner = false;
      })();
      return stopPromise;
    };

    return {
      api,
      hub,
      databasePath: options.databasePath,
      stop,
      get state() {
        return state;
      },
      get databaseClosed() {
        return closed;
      },
    };
  } catch (error) {
    try {
      db?.close();
    } finally {
      activeOwner = false;
    }
    throw error;
  }
}

function validateApi(api: ApiDefinition): void {
  if (!api || typeof api !== "object" || !api.query || !api.mutation)
    throw new Error("createApi must return defineApi({ query, mutation })");
  for (const [name, query] of Object.entries(api.query)) {
    if (
      !Object.prototype.hasOwnProperty.call(api.query, name) ||
      !Array.isArray(query.dependsOn) ||
      typeof query.run !== "function"
    )
      throw new Error(`Invalid query: ${name}`);
  }
  for (const [name, mutation] of Object.entries(api.mutation))
    if (typeof mutation.run !== "function")
      throw new Error(`Invalid mutation: ${name}`);
}
