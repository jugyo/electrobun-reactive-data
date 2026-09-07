# Electrobun Reactive Data

Independent library for typed, reactive `bun:sqlite` data shared by multiple Electrobun windows. It owns one SQLite connection in the Bun main process and uses Electrobun's per-view RPC; the application creates no HTTP or WebSocket listener and exposes no port or origin setting. Version `0.1.0` is an early release under MIT, not a stable 1.0 API.

This repository independently specializes selected ideas and source from [@jugyo/reactive-data](https://github.com/jugyo/reactive-data/tree/aae2542fe4ab640d1ac5176b3ff02d8a00a0fb06). The retained MIT license is in [LICENSE](LICENSE). The HTTP/WebSocket and Node transports were deliberately not copied.

## Versions and requirements

- Electrobun/Hutch SDK: exactly `2.0.1`
- Electrobun bundled Bun runtime: `1.4.0`
- React/React DOM: `19.1.1`
- Support is limited to the verified macOS / Apple Silicon workflow (macOS 14+ target). Windows, Linux, and Intel Macs are not certified.

Before 1.0, patch releases (`0.1.x`) contain compatible fixes; breaking API changes require a new minor version (`0.2.0`) and migration notes. Only `/main`, `/client`, and `/react` are public contracts. Schema migrations, signing, and application form behavior remain application responsibilities.

## Install

```sh
npm install @jugyo/electrobun-reactive-data@0.1.0 electrobun@2.0.1 react@19.1.1 react-dom@19.1.1
```

Use this package in an Electrobun application with the Bun main process and a prepared devkit. It ships TypeScript source for the verified Bun/Vite toolchain; it is not a standalone Node.js server package. See the Vite alias configuration below.

The checked-in npm lockfile pins JavaScript dependencies. `.hutch/devkit` and native artifacts are generated and ignored.

## Run and verify

```sh
git clone https://github.com/jugyo/electrobun-reactive-data.git
cd electrobun-reactive-data
npm ci
npm run prepare:native
npm test
npm run typecheck
npm run build
npm run dev
```

External Vite builds must resolve the browser SDK from the prepared Hutch devkit, not from the `electrobun` npm bootstrap package:

```ts
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";

export default defineConfig({
  resolve: {
    alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")),
  },
});
```

The demo opens two windows over the same file at `Utils.paths.userData/reactive-data.sqlite`. Add, complete, filter, and delete items in either window; both windows refresh after committed mutations. Restart the app to check persistence. The UI shows a per-query refresh counter in development.

## Public API

Main process (schema creation is application-owned, not an automatic migration):

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

Renderer (one client per document; import the main contract as a type only):

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
// UI event handlers may call await api.mutation.add({ title: "Hello" }); catch errors in the UI.
```

The main entry point exports `createReactiveData`, `defineApi`, and `defineTrigger`. `createReactiveData` defaults the database path to the Electrobun application data directory and accepts `databasePath` for isolated tests. Handlers are synchronous by design: returning a thenable fails and rolls back a mutation. `stop()` is idempotent, rejects new admissions, removes sessions and timers, drains admitted work, and closes SQLite once. Set `handleQuit: false` only when the application owns quit coordination and calls `await data.stop()` itself.

The browser entry point exports `createReactiveDataClient<AppApi>()`; `/react` exports `ReactiveDataProvider` and `useLiveQuery`. Import the main API type with `import type` only. Query parameters create independent cache entries while subscriptions use the operation ID. A full active-query set is replaced on every subscription revision. Reload/reconnect creates a new generation and re-fetches accepted active queries.

The last provider unmount stops its runtime. Direct runtime owners must call `runtime.stop()`; stopped clients cannot restart. Subscription failures put active live queries into `status: "error"` and do not trigger background retry loops. A subsequent query/explicit `refresh()` or subscription change retries submission. Query invocation has one recovery attempt after a stale session or transport failure; mutations are never automatically retried because their commit outcome may be unknown.

### Errors and synchronous DTOs

```ts
import {
  createReactiveDataClient,
  ReactiveDataError,
} from "@jugyo/electrobun-reactive-data/client";
import type { AppApi } from "./bun/api";

const { api, runtime } = createReactiveDataClient<AppApi>({
  onError(error) {
    // Background connection/subscription errors; show an application notification.
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

Direct operations reject with `ReactiveDataError` (including server codes, `TRANSPORT`, and `STOPPED`). Live-query errors are delivered through the hook snapshot; `refresh()` attempts another read but reports read failure in the snapshot rather than rejecting. Background errors also call optional `onError`, or log by default. A failed subscription stays visible until that query's subscription is accepted and a fresh read succeeds; an older in-flight success cannot clear it. Hook errors do not automatically throw into a React error boundary.

Handlers and validators must be synchronous. Inputs, normalized inputs, and outputs must be finite JSON DTOs: null, booleans, strings, finite numbers, dense arrays, and plain objects containing those values. Accessors, custom prototypes, `Date`, bigint, undefined (including array holes), functions, promises, symbols, cycles, and non-finite numbers are rejected. Shared references without cycles are allowed. Compile-time checks support named interfaces and readonly tuples, reject common invalid types, and stop at 16 nested type levels; runtime validation remains authoritative with a 64-level nesting limit.

The encoded JSON ceiling is 256 KiB (UTF-8): the client checks the input value; main dispatch checks the complete invoke parameter object (session, kind, name, input); normalized input and result values are each checked separately. Response-envelope overhead is not counted. Leave room for the invocation envelope when sending large inputs. Mutation output validation happens before commit, so invalid output rolls back without invalidation. Getters and `toJSON` are not intentionally invoked; hostile Proxy side effects are outside the contract.

Pre-1.0 migration: serialize dates explicitly, convert bigint IDs intentionally, return `null` instead of `void`, omit optional fields instead of assigning `undefined`, and move async/network work outside handlers. Recognizable async functions are rejected before execution; this is not cancellation and cannot undo concealed asynchronous work. These stricter contracts intentionally reject previously accepted lossy JSON conversions.

`createWindow` owns the view RPC and admits only local `views://` URLs. Navigation is restricted to the initial URL's view host (for example, `views://notes/*`), not a hard-coded demo name. Remote privileged views and custom RPC composition are not supported. Caller-supplied navigation/sandbox settings do not override this policy.

## Local package consumption

The library is independent of the original reactive-data workspace. It ships TypeScript source for the verified Bun/Vite toolchain; only `/main`, `/client`, and `/react` are public. Do not import internal files. Install the pinned Electrobun and React peers in the application; React DOM is application-owned.

```sh
# From this library directory; validates public exports/types before packing.
npm pack --pack-destination examples/notes-consumer/vendor
cd examples/notes-consumer
npm install ./vendor/jugyo-electrobun-reactive-data-0.1.0.tgz
npm run prepare:native
npm run build
```

Use npm for released versions, or clone and pack locally using the prepared devkit for development. Direct Git dependency installation is not the supported workflow because packing requires development tools and the Electrobun devkit.

## Native regression checks

Build Todo with `npm run build && ./node_modules/.bin/electrobun build --env=dev`, then run `npm run native:acceptance`. Build Notes with `npm run native:build` in its directory, then run `npm run native:acceptance:notes` from the library root.

Each command starts the packaged native app with a fresh temporary database, checks semantic assertions in both WebViews, checks clean process exit, and relaunches to assert persistence. Report paths are printed and retained. Failed assertions, missing reports, abnormal exits, or shutdown timeouts fail the command. The 60-second process deadline is not a performance benchmark. These checks exercise renderer APIs and React snapshots, not human typing/clicking or visual quality.

## PoC limits

Only JSON-compatible results are supported. Async database handlers, direct writes on the owner's connection outside mutations, multiple owners, multiple processes, durable notification replay, remote content in privileged views, and cross-platform certification are out of scope. External SQLite connections are observed because the managed triggers write to the shared change log; polling latency defaults to 100 ms.

See [VERIFICATION.md](VERIFICATION.md) for executed evidence and remaining native checks.

The independently installed CRUD example is under `examples/notes-consumer`; see [ADOPTION.md](ADOPTION.md) for the adoption assessment.
