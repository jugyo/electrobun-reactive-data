import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "../src/protocol.js";
import { defineApi } from "../src/main/api.js";
import { createDataOwner } from "../src/main/owner.js";
import { defineTrigger } from "../src/main/sqlite.js";
import type { SessionEndpoint } from "../src/main/hub.js";

function temporaryPath() {
  const directory = mkdtempSync(join(tmpdir(), "erd-owner-"));
  return { directory, databasePath: join(directory, "data.sqlite") };
}

function createFixture(databasePath: string, overrides: Record<string, { run(input: any): any }> = {}) {
  const notifications: string[][] = [];
  const owner = createDataOwner({
    databasePath,
    pollIntervalMs: 60_000,
    createApi(db) {
      db.exec("CREATE TABLE todos(id INTEGER PRIMARY KEY, title TEXT NOT NULL)");
      return defineApi({
        query: { todos: { dependsOn: ["todos"], run: (_input: {}) => db.query("SELECT * FROM todos ORDER BY id").all() } },
        mutation: {
          add: { run({ title }: { title: string }) { db.query("INSERT INTO todos(title) VALUES (?)").run(title); return { ok: true }; } },
          unsupported: { run(_input: {}) { db.query("INSERT INTO todos(title) VALUES ('bigint')").run(); return 1n; } },
          oversized: { run(_input: {}) { db.query("INSERT INTO todos(title) VALUES ('oversized')").run(); return "x".repeat(300_000); } },
          async: { run(_input: {}) { db.query("INSERT INTO todos(title) VALUES ('async')").run(); return Promise.resolve({ ok: true }); } },
          throws: { run(_input: {}) { db.query("INSERT INTO todos(title) VALUES ('throw')").run(); throw new Error("handler failed"); } },
          ...overrides,
        },
      });
    },
    triggers: [defineTrigger({ table: "todos" })],
  });
  const endpoint: SessionEndpoint = { sendChanged(message) { notifications.push(message.queries); } };
  const connected = owner.hub.connect(endpoint, PROTOCOL_VERSION);
  if (!connected.ok) throw new Error("connection failed");
  owner.hub.setQueries(endpoint, { session: connected.value.session, revision: 1, queries: ["query.todos"] });
  return { owner, endpoint, session: connected.value.session, notifications };
}

describe("real data owner transaction and lifecycle", () => {
  test("BEGIN failure releases admission so idempotent stop completes and ownership is reusable", async () => {
    const paths = temporaryPath();
    try {
      const fixture = createFixture(paths.databasePath);
      const writer = new Database(paths.databasePath);
      writer.exec("BEGIN IMMEDIATE");
      const result = fixture.owner.hub.invoke(fixture.endpoint, { session: fixture.session, kind: "mutation", name: "add", input: { title: "blocked" } });
      expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      const firstStop = fixture.owner.stop();
      expect(fixture.owner.stop()).toBe(firstStop);
      await firstStop;
      expect(fixture.owner.state).toBe("stopped");
      writer.exec("ROLLBACK"); writer.close();
      const replacement = createDataOwner({ databasePath: paths.databasePath, createApi: () => defineApi({ query: {}, mutation: {} }), triggers: [] });
      await replacement.stop();
    } finally { rmSync(paths.directory, { recursive: true, force: true }); }
  });

  test("unsupported, oversized, async, and thrown results roll back without invalidation", async () => {
    const paths = temporaryPath();
    try {
      const fixture = createFixture(paths.databasePath);
      for (const name of ["unsupported", "oversized", "async", "throws"]) {
        const result = fixture.owner.hub.invoke(fixture.endpoint, { session: fixture.session, kind: "mutation", name, input: {} });
        expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      }
      const rows = fixture.owner.hub.invoke(fixture.endpoint, { session: fixture.session, kind: "query", name: "todos", input: {} });
      expect(rows).toEqual({ ok: true, value: [] });
      expect(fixture.notifications).toEqual([]);
      await fixture.owner.stop();
      expect(fixture.owner.hub.invoke(fixture.endpoint, { session: fixture.session, kind: "query", name: "todos", input: {} })).toMatchObject({ ok: false, error: { code: "STOPPING" } });
    } finally { rmSync(paths.directory, { recursive: true, force: true }); }
  });

  test("commits before notifying and closes after stop", async () => {
    const paths = temporaryPath();
    try {
      let observedRows = -1;
      const fixture = createFixture(paths.databasePath);
      fixture.endpoint.sendChanged = () => { const check = new Database(paths.databasePath, { readonly: true }); observedRows = Number(check.query<{ count: number }, []>("SELECT count(*) AS count FROM todos").get()!.count); check.close(); };
      expect(fixture.owner.hub.invoke(fixture.endpoint, { session: fixture.session, kind: "mutation", name: "add", input: { title: "committed" } })).toEqual({ ok: true, value: { ok: true } });
      expect(observedRows).toBe(1);
      await fixture.owner.stop();
      expect(fixture.owner.databaseClosed).toBe(true);
    } finally { rmSync(paths.directory, { recursive: true, force: true }); }
  });

  test("directory and database-open failures release global ownership", async () => {
    const paths = temporaryPath();
    try {
      expect(() => createDataOwner({ databasePath: paths.databasePath, createApi: () => defineApi({ query: {}, mutation: {} }), triggers: [], makeDirectory() { throw new Error("mkdir failed"); } })).toThrow("mkdir failed");
      expect(() => createDataOwner({ databasePath: paths.databasePath, createApi: () => defineApi({ query: {}, mutation: {} }), triggers: [], openDatabase() { throw new Error("open failed"); } })).toThrow("open failed");
      const owner = createDataOwner({ databasePath: paths.databasePath, createApi: () => defineApi({ query: {}, mutation: {} }), triggers: [] });
      await owner.stop();
    } finally { rmSync(paths.directory, { recursive: true, force: true }); }
  });
});
