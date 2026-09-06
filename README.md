# Electrobun Reactive Data

Independent, experimental library for typed, reactive `bun:sqlite` data shared by multiple Electrobun windows. It owns one SQLite connection in the Bun main process and uses Electrobun's per-view RPC; the application creates no HTTP or WebSocket listener and exposes no port or origin setting. Source is public on GitHub under MIT; version `0.0.0-poc` is not a stable release and is not published to npm.

This repository independently specializes selected ideas and source from [@jugyo/reactive-data](https://github.com/jugyo/reactive-data/tree/aae2542fe4ab640d1ac5176b3ff02d8a00a0fb06). The retained MIT license is in [LICENSE](LICENSE). The HTTP/WebSocket and Node transports were deliberately not copied.

## Versions and requirements

- Electrobun/Hutch SDK: exactly `2.0.1`
- Electrobun bundled Bun runtime: `1.4.0`
- React/React DOM: `19.1.1`
- macOS 14+ on Apple Silicon is the native PoC target

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
  resolve: { alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")) },
});
```

The demo opens two windows over the same file at `Utils.paths.userData/reactive-data.sqlite`. Add, complete, filter, and delete items in either window; both windows refresh after committed mutations. Restart the app to check persistence. The UI shows a per-query refresh counter in development.

## Public API

Main process (schema creation is application-owned, not an automatic migration):

```ts
import { createReactiveData, defineApi, defineTrigger } from "@jugyo/electrobun-reactive-data/main";

const data = createReactiveData({
  createApi(db) {
    db.exec("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)");
    return defineApi({
      query: {
        notes: {
          dependsOn: ["notes"],
          run: (_input: {}) => db.query<{ id: number; title: string }, []>("SELECT id, title FROM notes ORDER BY id").all(),
        },
      },
      mutation: {
        add: {
          validate(input: unknown): { title: string } {
            if (!input || typeof input !== "object" || !("title" in input) || typeof input.title !== "string" || !input.title.trim()) throw new Error("Title is required");
            return { title: input.title.trim() };
          },
          run({ title }: { title: string }) { db.query("INSERT INTO notes(title) VALUES (?)").run(title); return { ok: true }; },
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
import { ReactiveDataProvider, useLiveQuery } from "@jugyo/electrobun-reactive-data/react";
import type { AppApi } from "../bun/index.js";

const { api, runtime } = createReactiveDataClient<AppApi>();
function Notes() {
  const notes = useLiveQuery(api.query.notes, {});
  if (notes.status === "loading") return <p>Loading…</p>;
  if (notes.status === "error") return <button onClick={() => void notes.refresh()}>Retry</button>;
  return <ul>{notes.data.map((note) => <li key={note.id}>{note.title}</li>)}</ul>;
}
export function App() {
  return <ReactiveDataProvider runtime={runtime}><Notes /></ReactiveDataProvider>;
}
// UI event handlers may call await api.mutation.add({ title: "Hello" }); catch errors in the UI.
```

The main entry point exports `createReactiveData`, `defineApi`, and `defineTrigger`. `createReactiveData` defaults the database path to the Electrobun application data directory and accepts `databasePath` for isolated tests. Handlers are synchronous by design: returning a thenable fails and rolls back a mutation. `stop()` is idempotent, rejects new admissions, removes sessions and timers, drains admitted work, and closes SQLite once. Set `handleQuit: false` only when the application owns quit coordination and calls `await data.stop()` itself.

The browser entry point exports `createReactiveDataClient<AppApi>()`; `/react` exports `ReactiveDataProvider` and `useLiveQuery`. Import the main API type with `import type` only. Query parameters create independent cache entries while subscriptions use the operation ID. A full active-query set is replaced on every subscription revision. Reload/reconnect creates a new generation and re-fetches accepted active queries.

Provider unmount stops its runtime. Direct runtime owners must call `runtime.stop()`; stopped clients cannot restart. Subscription failures are logged and do not trigger background retry loops. A subsequent query/explicit `refresh()` or subscription change retries submission. Query invocation has one recovery attempt after a stale session or transport failure; mutations are never automatically retried because their commit outcome may be unknown.

`createWindow` owns the view RPC and admits only local `views://` URLs. Navigation is restricted to the initial URL's view host (for example, `views://notes/*`), not a hard-coded demo name. Remote privileged views and custom RPC composition are not supported. Caller-supplied navigation/sandbox settings do not override this policy.

## Local package consumption

The library is independent of the original reactive-data workspace. It ships TypeScript source for the verified Bun/Vite toolchain; only `/main`, `/client`, and `/react` are public. Do not import internal files. Install the pinned Electrobun and React peers in the application; React DOM is application-owned.

```sh
# From this library directory; validates public exports/types before packing.
npm pack --pack-destination examples/notes-consumer/vendor
cd examples/notes-consumer
npm install ./vendor/jugyo-electrobun-reactive-data-0.0.0-poc.tgz
npm run prepare:native
npm run build
```

`private: true` prevents accidental npm publication; it does not restrict use of this public MIT-licensed source. Clone and pack locally using the prepared devkit. Direct Git dependency installation is not the supported workflow because packing requires development tools and the Electrobun devkit.

## Native regression checks

Build Todo with `npm run build && ./node_modules/.bin/electrobun build --env=dev`, then run `npm run native:acceptance`. Build Notes with `npm run native:build` in its directory, then run `npm run native:acceptance:notes` from the library root.

Each command starts the packaged native app with a fresh temporary database, checks semantic assertions in both WebViews, checks clean process exit, and relaunches to assert persistence. Report paths are printed and retained. Failed assertions, missing reports, abnormal exits, or shutdown timeouts fail the command. The 60-second process deadline is not a performance benchmark. These checks exercise renderer APIs and React snapshots, not human typing/clicking or visual quality.

## PoC limits

Only JSON-compatible results are supported. Async database handlers, direct writes on the owner's connection outside mutations, multiple owners, multiple processes, durable notification replay, remote content in privileged views, and cross-platform certification are out of scope. External SQLite connections are observed because the managed triggers write to the shared change log; polling latency defaults to 100 ms.

See [VERIFICATION.md](VERIFICATION.md) for executed evidence and remaining native checks.

The independently installed CRUD example is under `examples/notes-consumer`; see [ADOPTION.md](ADOPTION.md) for the adoption assessment.
