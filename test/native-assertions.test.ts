import { expect, test } from "bun:test";
import {
  assertNotesAcceptance,
  assertNotesPersistence,
  persistedNotes,
  saved,
} from "../examples/notes/test/assertions.js";
const snapshot = (rows: unknown[]) => ({
  status: "success",
  refreshCount: 3,
  rows,
  renderedRows: rows,
  text: "",
});
const pair = (rows: unknown[]) => [snapshot(rows), snapshot(rows)];
const created = [{ title: "native note", body: "first body" }];
const other = [{ title: "other note", body: "filter probe" }];
const persisted = snapshot(persistedNotes);
const stages = {
  created: pair(created),
  subscriptionError: {
    status: "error",
    error: "Injected subscription failure",
    text: "Injected subscription failure",
  },
  subscriptionRecovered: snapshot(created),
  edited: pair(saved),
  filters: [snapshot(saved), snapshot(other)],
  reloaded: [
    snapshot([
      { title: "after reload", body: "persist me" },
      ...saved,
      ...other,
    ]),
    snapshot(other),
  ],
  deleted: [snapshot([...saved, ...other]), snapshot(other)],
  beforeRollback: persisted,
  afterRollback: persisted,
  idle: { before: persisted, after: persisted },
};
test("Notes acceptance covers CRUD, errors, filters, close, rollback, idle and persistence", () => {
  expect(() => assertNotesAcceptance(stages)).not.toThrow();
  expect(() => assertNotesPersistence(pair(persistedNotes))).not.toThrow();
});
test("Notes assertions reject stale data, UI, filters, errors, rollback invalidation and idle refetch", () => {
  for (const invalid of [
    { ...stages, edited: pair(created) },
    { ...stages, subscriptionError: { ...stages.subscriptionError, text: "" } },
    { ...stages, subscriptionRecovered: snapshot([]) },
    { ...stages, filters: pair(saved) },
    { ...stages, reloaded: pair(saved) },
    { ...stages, deleted: pair([]) },
    { ...stages, beforeRollback: snapshot(saved) },
    { ...stages, afterRollback: { ...persisted, refreshCount: 4 } },
    {
      ...stages,
      idle: { before: persisted, after: { ...persisted, refreshCount: 4 } },
    },
    {
      ...stages,
      edited: [{ ...snapshot(saved), renderedRows: [] }, snapshot(saved)],
    },
  ])
    expect(() => assertNotesAcceptance(invalid)).toThrow();
  expect(() => assertNotesPersistence(pair([]))).toThrow();
});
