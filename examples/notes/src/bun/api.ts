import type { Database } from "bun:sqlite";
import { defineApi } from "@jugyo/electrobun-reactive-data/main";

export function createNotesApi(db: Database) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  return defineApi({
    query: {
      notes: {
        dependsOn: ["notes"],
        validate: searchInput,
        run: ({ search }: { search: string }) =>
          db
            .query<
              { id: number; title: string; body: string; updatedAt: number },
              [string]
            >(
              "SELECT id, title, body, updated_at AS updatedAt FROM notes WHERE instr(lower(title), lower(?)) > 0 ORDER BY updated_at DESC, id DESC",
            )
            .all(search),
      },
    },
    mutation: {
      create: {
        validate: noteInput,
        run(input: NoteInput) {
          db.query(
            "INSERT INTO notes(title, body, updated_at) VALUES (?, ?, ?)",
          ).run(input.title, input.body, Date.now());
          return { ok: true };
        },
      },
      update: {
        validate: updateInput,
        run(input: NoteInput & { id: number }) {
          db.query(
            "UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?",
          ).run(input.title, input.body, Date.now(), input.id);
          return { ok: true };
        },
      },
      remove: {
        validate: idInput,
        run({ id }: { id: number }) {
          db.query("DELETE FROM notes WHERE id=?").run(id);
          return { ok: true };
        },
      },
    },
  });
}

type NoteInput = { title: string; body: string };
function noteInput(input: unknown): NoteInput {
  if (
    !input ||
    typeof input !== "object" ||
    !("title" in input) ||
    typeof input.title !== "string" ||
    !("body" in input) ||
    typeof input.body !== "string"
  )
    throw new Error("Invalid note");
  const title = input.title.trim();
  if (!title || title.length > 120 || input.body.length > 10_000)
    throw new Error("Invalid note");
  return { title, body: input.body };
}
function idInput(input: unknown): { id: number } {
  if (
    !input ||
    typeof input !== "object" ||
    !("id" in input) ||
    !Number.isSafeInteger(input.id)
  )
    throw new Error("Invalid id");
  return { id: Number(input.id) };
}
function updateInput(input: unknown): NoteInput & { id: number } {
  return { ...noteInput(input), ...idInput(input) };
}

function searchInput(input: unknown): { search: string } {
  if (
    !input ||
    typeof input !== "object" ||
    !("search" in input) ||
    typeof input.search !== "string"
  )
    throw new Error("Invalid search");
  return { search: input.search };
}
