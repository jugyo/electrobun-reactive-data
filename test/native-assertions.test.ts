import { expect, test } from "bun:test";
import {
  assertTodoAcceptance,
  assertTodoPersistence,
  persistedTodos,
} from "../demo/bun/acceptance.js";
import {
  assertNotesAcceptance,
  assertNotesPersistence,
} from "../examples/notes-consumer/src/bun/acceptance.js";

const snapshot = (rows: unknown[]) => ({
  status: "success",
  refreshCount: 3,
  rows,
});
const pair = (rows: unknown[]) => [snapshot(rows), snapshot(rows)];
test("Todo assertions reject stale views, rollback invalidation, and missing persisted rows", () => {
  const persisted = snapshot(persistedTodos);
  const stages = {
    afterAdd: pair([{ title: "new", done: 0 }]),
    subscriptionError: {
      status: "error",
      error: "Injected subscription failure",
    },
    subscriptionRecovered: snapshot([{ title: "new", done: 0 }]),
    afterToggle: pair([{ title: "new", done: 1 }]),
    afterDelete: pair([]),
    filters: [
      snapshot([{ title: "active-filter", done: 0 }]),
      snapshot([{ title: "completed-filter", done: 1 }]),
    ],
    afterReload: [
      snapshot(persistedTodos.filter((row) => row.title !== "after-close")),
      snapshot([{ title: "completed-filter", done: 1 }]),
    ],
    beforeRollback: persisted,
    afterCloseAndRollback: persisted,
    idle: { before: persisted, after: persisted },
  };
  expect(() => assertTodoAcceptance("new", stages)).not.toThrow();
  expect(() => assertTodoPersistence(pair(persistedTodos))).not.toThrow();
  expect(() =>
    assertTodoAcceptance("new", { ...stages, afterAdd: pair([]) }),
  ).toThrow();
  expect(() =>
    assertTodoAcceptance("new", {
      ...stages,
      afterCloseAndRollback: { ...persisted, refreshCount: 4 },
    }),
  ).toThrow();
  expect(() => assertTodoPersistence(pair([]))).toThrow();
});
test("Notes assertions reject stale edits and missing persisted rows", () => {
  const saved = [{ title: "native note", body: "edited body" }];
  const stages = {
    created: pair([{ title: "native note", body: "first body" }]),
    edited: pair(saved),
    reloaded: pair([{ title: "after reload", body: "persist me" }, ...saved]),
    deleted: pair(saved),
  };
  expect(() => assertNotesAcceptance(stages)).not.toThrow();
  expect(() => assertNotesPersistence(pair(saved))).not.toThrow();
  expect(() =>
    assertNotesAcceptance({ ...stages, edited: stages.created }),
  ).toThrow();
  expect(() => assertNotesPersistence(pair([]))).toThrow();
});
