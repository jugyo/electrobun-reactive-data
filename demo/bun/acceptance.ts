import { deepStrictEqual, equal, ok } from "node:assert/strict";

type Snapshot = { status: string; refreshCount: number; rows: Array<{ title: string; done: number }> };
function rows(value: unknown) {
  const snapshot = value as Snapshot;
  equal(snapshot.status, "success");
  ok(snapshot.refreshCount > 0);
  return snapshot.rows.map(({ title, done }) => ({ title, done })).sort((a, b) => a.title.localeCompare(b.title));
}
function pair(value: unknown, expected: Array<{ title: string; done: number }>) {
  const snapshots = value as unknown[];
  equal(snapshots.length, 2);
  for (const snapshot of snapshots) deepStrictEqual(rows(snapshot), expected);
}
export const persistedTodos = [
  { title: "active-filter", done: 0 }, { title: "after-close", done: 0 },
  { title: "after-reload", done: 0 }, { title: "completed-filter", done: 1 },
];
export function assertTodoPersistence(windows: unknown): void { pair(windows, persistedTodos); }
export function assertTodoAcceptance(title: string, stages: Record<string, any>): void {
  pair(stages.afterAdd, [{ title, done: 0 }]);
  pair(stages.afterToggle, [{ title, done: 1 }]);
  pair(stages.afterDelete, []);
  deepStrictEqual(rows(stages.filters[0]), [{ title: "active-filter", done: 0 }]);
  deepStrictEqual(rows(stages.filters[1]), [{ title: "completed-filter", done: 1 }]);
  deepStrictEqual(rows(stages.afterReload[0]), persistedTodos.filter((row) => row.title !== "after-close"));
  deepStrictEqual(rows(stages.afterReload[1]), [{ title: "completed-filter", done: 1 }]);
  deepStrictEqual(rows(stages.beforeRollback), persistedTodos);
  deepStrictEqual(rows(stages.afterCloseAndRollback), persistedTodos);
  equal(stages.beforeRollback.refreshCount, stages.afterCloseAndRollback.refreshCount, "Rollback must not invalidate queries");
  deepStrictEqual(rows(stages.idle.after), persistedTodos);
  deepStrictEqual(stages.idle.before, stages.idle.after, "Idle views must not refetch");
}
