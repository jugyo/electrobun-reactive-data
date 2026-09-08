# Notes

A multi-window React and SQLite example using the public Electrobun Reactive Data package APIs. Create, edit, delete, and search notes; each window has its own search while sharing updates.

From this directory:

```sh
npm ci
npm run prepare:native
npm run dev
```

The checked-in local archive makes this a standalone package consumer. To test current library changes, run `npm run example:check` from the repository root before starting the example.

Start reading at `src/bun/api.ts` for queries and mutations, `src/bun/index.ts` for windows, and `src/mainview/main.tsx` for React. `test/` contains the optional native regression harness, not application features. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for test commands. Native test builds and normal builds share output directories and must run sequentially.
