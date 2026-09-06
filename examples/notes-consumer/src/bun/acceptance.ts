import { deepStrictEqual, equal, ok } from "node:assert/strict";

function pair(value: unknown, expected: Array<{ title: string; body: string }>): void {
  const snapshots = value as Array<{ status: string; refreshCount: number; rows: Array<{ title: string; body: string }> }>;
  equal(snapshots.length, 2);
  for (const snapshot of snapshots) {
    equal(snapshot.status, "success");
    ok(snapshot.refreshCount > 0);
    deepStrictEqual(snapshot.rows.map(({ title, body }) => ({ title, body })), expected);
  }
}
const persisted = [{ title: "native note", body: "edited body" }];
export function assertNotesPersistence(windows: unknown): void { pair(windows, persisted); }
export function assertNotesAcceptance(stages: Record<string, unknown>): void {
  pair(stages.created, [{ title: "native note", body: "first body" }]);
  pair(stages.edited, persisted);
  pair(stages.reloaded, [{ title: "after reload", body: "persist me" }, ...persisted]);
  pair(stages.deleted, persisted);
}
