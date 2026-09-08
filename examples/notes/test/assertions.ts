import { deepStrictEqual, equal, ok } from "node:assert/strict";
type Row = { title: string; body: string };
type Snapshot = {
  status: string;
  refreshCount: number;
  rows: Row[];
  renderedRows: Row[];
  error?: string;
  text: string;
};
const ordered = (rows: Row[]) =>
  rows
    .map(({ title, body }) => ({ title, body }))
    .sort((a, b) => a.title.localeCompare(b.title));
function snapshot(value: unknown, expected: Row[]) {
  const result = value as Snapshot;
  equal(result.status, "success");
  ok(result.refreshCount > 0);
  deepStrictEqual(ordered(result.rows), ordered(expected));
  deepStrictEqual(
    ordered(result.renderedRows),
    ordered(expected),
    "React UI must match the data snapshot",
  );
}
function pair(value: unknown, expected: Row[]) {
  const windows = value as unknown[];
  equal(windows.length, 2);
  for (const window of windows) snapshot(window, expected);
}
export const saved = [{ title: "native note", body: "edited body" }];
const other = [{ title: "other note", body: "filter probe" }];
export const persistedNotes = [
  { title: "after close", body: "still updating" },
  ...saved,
  ...other,
];
export function assertNotesPersistence(windows: unknown) {
  pair(windows, persistedNotes);
}
export function assertNotesAcceptance(stages: Record<string, unknown>) {
  const created = [{ title: "native note", body: "first body" }];
  pair(stages.created, created);
  const failure = stages.subscriptionError as Snapshot;
  equal(failure.status, "error");
  equal(failure.error, "Injected subscription failure");
  ok(
    failure.text.includes("Injected subscription failure"),
    "React must display the subscription error",
  );
  snapshot(stages.subscriptionRecovered, created);
  pair(stages.edited, saved);
  const filters = stages.filters as unknown[];
  equal(filters.length, 2);
  snapshot(filters[0], saved);
  snapshot(filters[1], other);
  const reloaded = stages.reloaded as unknown[];
  equal(reloaded.length, 2);
  snapshot(reloaded[0], [
    { title: "after reload", body: "persist me" },
    ...saved,
    ...other,
  ]);
  snapshot(reloaded[1], other);
  const deleted = stages.deleted as unknown[];
  equal(deleted.length, 2);
  snapshot(deleted[0], [...saved, ...other]);
  snapshot(deleted[1], other);
  snapshot(stages.beforeRollback, persistedNotes);
  snapshot(stages.afterRollback, persistedNotes);
  equal(
    (stages.beforeRollback as Snapshot).refreshCount,
    (stages.afterRollback as Snapshot).refreshCount,
    "Rollback must not invalidate queries",
  );
  const idle = stages.idle as { before: unknown; after: unknown };
  snapshot(idle.after, persistedNotes);
  deepStrictEqual(idle.before, idle.after, "Idle views must not refetch");
}
