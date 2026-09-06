# Contributing

This is an experimental Electrobun-specific library, not a stable npm release.

Use macOS 14+ on Apple Silicon for the currently verified native workflow. Install Node.js 22.12+ and Bun 1.3.14; the pinned Electrobun 2.0.1 devkit bundles Bun 1.4.0 for native execution.

```sh
npm ci
npm run prepare:native
npm test
npm run build
./node_modules/.bin/electrobun build --env=dev
npm run native:acceptance
```

For package-consumer validation, pack locally, reinstall the archive into `examples/notes-consumer`, build that application, and run `npm run native:acceptance:notes` from the library root. See README.md for exact commands. Keep the checked-in consumer archive and lockfile synchronized with library changes; inspect its contents before committing.

Keep changes narrow and write documentation, comments, and commit messages in English. Preserve the `/main`, `/client`, and `/react` boundaries. Renderer code must not import main-process or SQLite values. Test query subscriptions, errors, transaction ordering, and lifecycle changes against the real implementation paths. Add native coverage for changes crossing the view bridge or application lifecycle.

Report commands, runtime versions, failures, and limitations honestly. Native regression commands test renderer APIs and React snapshots, not visual quality or human typing. Never commit databases, credentials, devkit downloads, node_modules, or native builds. Run `git diff --check` and inspect the complete staged diff and archive contents before committing. There is currently no lint script or hosted CI; local checks and macOS native evidence are required.

Pull requests should include a summary, acceptance criteria, test plan, executed evidence, and `UI / visual candidate: yes` or `no` with a reason. Do not add new runtimes, transports, automatic migrations, or npm publication as incidental changes.
