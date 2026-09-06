import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  consumeChanges,
  defineTrigger,
  reconcileTriggers,
} from "../src/main/sqlite.js";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});
describe("bun:sqlite integration", () => {
  test("captures committed writes but not rollbacks and persists", () => {
    const dir = mkdtempSync(join(tmpdir(), "erd-test-"));
    paths.push(dir);
    const path = join(dir, "data.sqlite");
    let db = new Database(path);
    db.exec(
      "CREATE TABLE todos(id INTEGER PRIMARY KEY, title TEXT); PRAGMA journal_mode=WAL",
    );
    reconcileTriggers(db, [defineTrigger({ table: "todos" })]);
    db.exec("BEGIN; INSERT INTO todos(title) VALUES ('kept'); COMMIT");
    expect(consumeChanges(db)).toEqual(["todos"]);
    db.exec("BEGIN; INSERT INTO todos(title) VALUES ('lost'); ROLLBACK");
    expect(consumeChanges(db)).toEqual([]);
    db.close();
    db = new Database(path);
    expect(
      db.query<{ title: string }, []>("SELECT title FROM todos").all(),
    ).toEqual([{ title: "kept" }]);
    db.close();
  });
  test("captures changes from a second connection", () => {
    const dir = mkdtempSync(join(tmpdir(), "erd-test-"));
    paths.push(dir);
    const path = join(dir, "data.sqlite");
    const owner = new Database(path);
    owner.exec("CREATE TABLE todos(id INTEGER PRIMARY KEY)");
    reconcileTriggers(owner, [defineTrigger({ table: "todos" })]);
    const external = new Database(path);
    external.exec("INSERT INTO todos DEFAULT VALUES");
    external.close();
    expect(consumeChanges(owner)).toEqual(["todos"]);
    owner.close();
  });
});
