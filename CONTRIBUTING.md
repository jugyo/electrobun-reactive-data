# Contributing

This is an experimental Electrobun-specific library, not a stable npm release.

Use macOS 14+ on Apple Silicon for the currently verified native workflow. Install Node.js 22.12+ and Bun 1.3.14; the pinned Electrobun 2.0.1 devkit bundles Bun 1.4.0 for native execution.

```sh
npm ci
npm run prepare:native
npm run format:check
npm run lint
npm test
npm run build
./node_modules/.bin/electrobun build --env=dev
npm run native:acceptance
```

For package-consumer validation, pack locally, reinstall the archive into `examples/notes-consumer`, and build that application:

```sh
npm pack --pack-destination examples/notes-consumer/vendor
cd examples/notes-consumer
npm install ./vendor/jugyo-electrobun-reactive-data-0.1.0.tgz
npm run prepare:native
npm run build
```

Build the Todo native app with `npm run build && ./node_modules/.bin/electrobun build --env=dev`, then run `npm run native:acceptance`. Build Notes with `npm run native:build` in its directory, then run `npm run native:acceptance:notes` from the library root. Each acceptance command starts a packaged app with a fresh temporary database, checks both WebViews and persistence after relaunch, and retains its report. The 60-second deadline is a failure guard, not a benchmark.

Keep the checked-in consumer archive and lockfile synchronized with library changes; inspect its contents before committing. Direct Git dependency installation is not supported because packing needs development tools and the prepared devkit.

The checked-in npm lockfile pins JavaScript dependencies. `.hutch/devkit` and native artifacts are generated and ignored.

Keep changes narrow and write documentation, comments, and commit messages in English. Preserve the `/main`, `/client`, and `/react` boundaries. Renderer code must not import main-process or SQLite values. Test query subscriptions, errors, transaction ordering, and lifecycle changes against the real implementation paths. Add native coverage for changes crossing the view bridge or application lifecycle.

Report commands, runtime versions, failures, and limitations honestly. Native regression commands test renderer APIs and React snapshots, not visual quality or human typing. Never commit databases, credentials, devkit downloads, node_modules, or native builds. Run `git diff --check` and inspect the complete staged diff and archive contents before committing. Prettier and Oxlint are pinned; use `npm run format` for mechanical formatting. The macOS GitHub Actions workflow checks formatting, lint, types, tests, renderer boundaries, exports, and packed-consumer builds. Native GUI acceptance remains a separately recorded local release gate; a configured workflow is not evidence of a successful hosted run.

Pull requests should include a summary, acceptance criteria, test plan, executed evidence, and `UI / visual candidate: yes` or `no` with a reason. Do not add new runtimes, transports, automatic migrations, or npm publication as incidental changes.
