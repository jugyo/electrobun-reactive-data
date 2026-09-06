import type { Database } from "bun:sqlite";

export type TriggerOperation = "insert" | "update" | "delete";
export interface TriggerDefinition {
  readonly id: string;
  readonly table: string;
  readonly events: readonly TriggerOperation[];
}

export function defineTrigger(options: { name?: string; table: string; events?: readonly TriggerOperation[] }): TriggerDefinition {
  return Object.freeze({
    id: options.name ?? options.table,
    table: options.table,
    events: Object.freeze(options.events ?? (["insert", "update", "delete"] as const)),
  });
}

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const triggerName = (id: string, operation: string) => `__erd_${id.replace(/[^a-zA-Z0-9_]/g, "_")}_${operation}`;

export function reconcileTriggers(db: Database, definitions: readonly TriggerDefinition[]): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate trigger ID: ${definition.id}`);
    ids.add(definition.id);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS __electrobun_reactive_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_id TEXT NOT NULL, operation TEXT NOT NULL
  )`);
  const desired = new Set<string>();
  for (const definition of definitions) {
    for (const operation of ["insert", "update", "delete"] as const) {
      const name = triggerName(definition.id, operation);
      if (!definition.events.includes(operation)) { db.exec(`DROP TRIGGER IF EXISTS ${quote(name)}`); continue; }
      desired.add(name);
      db.exec(`DROP TRIGGER IF EXISTS ${quote(name)}; CREATE TRIGGER ${quote(name)} AFTER ${operation.toUpperCase()} ON ${quote(definition.table)} BEGIN INSERT INTO __electrobun_reactive_changes(trigger_id, operation) VALUES (${literal(definition.id)}, ${literal(operation)}); END`);
    }
  }
  const rows = db.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE '__erd_%'").all();
  for (const row of rows) if (!desired.has(row.name)) db.exec(`DROP TRIGGER ${quote(row.name)}`);
}

export function consumeChanges(db: Database): string[] {
  const rows = db.query<{ id: number; trigger_id: string }, []>("SELECT id, trigger_id FROM __electrobun_reactive_changes ORDER BY id LIMIT 500").all();
  if (!rows.length) return [];
  const placeholders = rows.map(() => "?").join(",");
  db.query(`DELETE FROM __electrobun_reactive_changes WHERE id IN (${placeholders})`).run(...rows.map((row) => row.id));
  return [...new Set(rows.map((row) => row.trigger_id))];
}
