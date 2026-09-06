import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  reconcileTriggers,
  defineTrigger,
  consumeChanges,
} from "../src/main/sqlite.js";

test("colliding trigger IDs are rejected without touching the schema", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos(id INTEGER)");
    expect(() =>
      reconcileTriggers(db, [
        defineTrigger({ name: "a-b", table: "todos" }),
        defineTrigger({ name: "a_b", table: "todos" }),
      ]),
    ).toThrow("collision");
    expect(
      db.query("SELECT name FROM sqlite_schema WHERE type='trigger'").all(),
    ).toEqual([]);
  } finally {
    db.close();
  }
});
test("reconciliation preserves unrelated triggers and rolls back failed changes", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE todos(id INTEGER); CREATE TRIGGER aaerd_x AFTER INSERT ON todos BEGIN SELECT 1; END; CREATE TRIGGER __erd_unrelated AFTER INSERT ON todos BEGIN SELECT 1; END",
    );
    reconcileTriggers(db, [defineTrigger({ table: "todos" })]);
    const before = db
      .query("SELECT name, sql FROM sqlite_schema ORDER BY name")
      .all();
    expect(() =>
      reconcileTriggers(db, [
        defineTrigger({ table: "todos", events: ["insert"] }),
        defineTrigger({ table: "missing" }),
      ]),
    ).toThrow();
    expect(
      db.query("SELECT name, sql FROM sqlite_schema ORDER BY name").all(),
    ).toEqual(before);
    reconcileTriggers(db, []);
    expect(
      db
        .query(
          "SELECT name FROM sqlite_schema WHERE type='trigger' ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "__erd_unrelated" }, { name: "aaerd_x" }]);
  } finally {
    db.close();
  }
});
test("change consumption handles more than one batch without losing writes", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE todos(id INTEGER)");
    reconcileTriggers(db, [defineTrigger({ table: "todos" })]);
    db.transaction(() => {
      for (let i = 0; i < 1001; i++) db.exec("INSERT INTO todos VALUES (1)");
    })();
    for (let i = 0; i < 3; i++) expect(consumeChanges(db)).toEqual(["todos"]);
    expect(consumeChanges(db)).toEqual([]);
  } finally {
    db.close();
  }
});
