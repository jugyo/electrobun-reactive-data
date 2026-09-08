# Getting started and usage

This guide covers the public API and operational constraints of Electrobun Reactive Data `0.1.0`. For a complete application, see the independently installed [Notes example](../examples/notes).

## Prerequisites

Install the library and React DOM, then prepare the Electrobun/Hutch devkit:

```sh
npm install @jugyo/electrobun-reactive-data react-dom
npx electrobun prepare
```

Version 0.1.0 is verified with Electrobun 2.0.1, React 19.1.1, and React DOM 19.1.1. The package declares the exact Electrobun and React versions as peer dependencies.

The package ships TypeScript source for the verified Bun/Vite toolchain. It is not a standalone Node.js server package. External Vite builds must resolve the browser SDK from the prepared devkit:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")),
  },
});
```

## Main process

Create one data owner in the Bun main process. Schema creation is application-owned and is not an automatic migration.

```ts
import {
  createReactiveData,
  defineApi,
  defineTrigger,
} from "@jugyo/electrobun-reactive-data/main";

const data = createReactiveData({
  createApi(db) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)",
    );
    return defineApi({
      query: {
        notes: {
          dependsOn: ["notes"],
          run: (_input: {}) =>
            db
              .query<{ id: number; title: string }, []>(
                "SELECT id, title FROM notes ORDER BY id",
              )
              .all(),
        },
      },
      mutation: {
        add: {
          validate(input: unknown): { title: string } {
            if (
              !input ||
              typeof input !== "object" ||
              !("title" in input) ||
              typeof input.title !== "string" ||
              !input.title.trim()
            )
              throw new Error("Title is required");
            return { title: input.title.trim() };
          },
          run({ title }: { title: string }) {
            db.query("INSERT INTO notes(title) VALUES (?)").run(title);
            return { ok: true };
          },
        },
      },
    });
  },
  triggers: [defineTrigger({ table: "notes" })],
});

export type AppApi = typeof data.api;
data.createWindow({ title: "Notes", url: "views://notes/index.html" });
```

`createReactiveData` defaults to `Utils.paths.userData/reactive-data.sqlite`; use `databasePath` for another location or isolated tests. Each `createWindow` call owns its view RPC. Only local `views://` URLs are admitted, and navigation stays within the initial view host.

## Renderer

Create one client per renderer document and import the main-process contract as a type only:

```tsx
import { createReactiveDataClient } from "@jugyo/electrobun-reactive-data/client";
import {
  ReactiveDataProvider,
  useLiveQuery,
} from "@jugyo/electrobun-reactive-data/react";
import type { AppApi } from "../bun/index.js";

const { api, runtime } = createReactiveDataClient<AppApi>();

function Notes() {
  const notes = useLiveQuery(api.query.notes, {});
  if (notes.status === "loading") return <p>Loading…</p>;
  if (notes.status === "error")
    return <button onClick={() => void notes.refresh()}>Retry</button>;
  return (
    <ul>
      {notes.data.map((note) => (
        <li key={note.id}>{note.title}</li>
      ))}
    </ul>
  );
}

export function App() {
  return (
    <ReactiveDataProvider runtime={runtime}>
      <Notes />
    </ReactiveDataProvider>
  );
}

// In an event handler:
await api.mutation.add({ title: "Hello" });
```

Query parameters have independent cache entries. Subscription revisions replace the full active-query set; reloads and reconnects establish a new generation and refetch accepted active queries.

## Errors and recovery

Direct operations reject with `ReactiveDataError`, including server codes and the client-side `TRANSPORT` and `STOPPED` codes. Mutations are never automatically retried because a transport failure may occur after commit.

```ts
import {
  createReactiveDataClient,
  ReactiveDataError,
} from "@jugyo/electrobun-reactive-data/client";
import type { AppApi } from "../bun/index.js";

const { api, runtime } = createReactiveDataClient<AppApi>({
  onError(error) {
    console.error(error.code, error.message);
  },
});

try {
  await api.mutation.add({ title: "Hello" });
} catch (error) {
  if (error instanceof ReactiveDataError)
    console.error(error.code, error.message);
}
```

Live-query failures appear as `status: "error"` snapshots; `refresh()` retries the read but reports failure in the snapshot rather than rejecting. Hook errors do not automatically enter a React error boundary. Background failures call `onError`, or log by default, and do not start a retry loop. A failed subscription remains visible until its subscription is accepted and a fresh read succeeds; an older in-flight success cannot clear it. A later query, explicit refresh, or subscription change retries submission. Queries make one recovery attempt after a stale session or transport failure.

## Shutdown

The last `ReactiveDataProvider` unmount stops its renderer runtime. Code that owns a runtime directly must call `runtime.stop()`; a stopped client cannot restart.

Main-process `data.stop()` is idempotent: it rejects new work, removes sessions and timers, drains admitted work, and closes SQLite once. The default quit handler coordinates this automatically. Set `handleQuit: false` only when the application coordinates quit itself and calls `await data.stop()`.

## Constraints and compatibility

Only `/main`, `/client`, and `/react` are public entry points. Handlers and validators are synchronous because database mutations run in a single Bun-owned transaction. Move asynchronous or network work outside them; detecting an async result is not cancellation and cannot undo concealed asynchronous work.

Inputs, normalized inputs, and outputs must be finite JSON DTOs: `null`, booleans, strings, finite numbers, dense arrays, and plain objects containing those values. The runtime rejects accessors, custom prototypes, `Date`, bigint, `undefined` (including array holes), functions, promises, symbols, cycles, non-finite numbers, and nesting beyond 64 levels. Shared non-cyclic references are allowed. Static checks support named interfaces and readonly tuples and stop at 16 nested type levels; runtime validation remains authoritative.

Each encoded input, normalized input, and result has a 256 KiB UTF-8 ceiling. Main dispatch also checks the complete invocation parameter object, including session and operation metadata, so leave room for that envelope. Mutation output validation happens before commit; invalid output rolls back without invalidation. Getters and `toJSON` are not intentionally invoked, although hostile Proxy side effects are outside the contract.

For pre-1.0 migration, serialize dates explicitly, convert bigint IDs intentionally, return `null` instead of `void`, omit optional fields instead of assigning `undefined`, and keep handlers synchronous.

The verified native scope is Electrobun/Hutch `2.0.1`, its bundled Bun `1.4.0`, React/React DOM `19.1.1`, and macOS 14+ on Apple Silicon. Windows, Linux, Intel Macs, signing/notarization, direct writes on the owner's connection outside mutations, multiple owners or processes, remote privileged content, custom RPC composition, automatic schema migrations, and durable notification replay are not certified or supported. Caller-supplied navigation or sandbox settings cannot weaken the local-view policy. External SQLite writers are observed through the managed change log; polling defaults to 100 ms.
