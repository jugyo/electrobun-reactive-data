# Verification record

Date: 2026-09-07. Host: macOS arm64. Node 26.7.0; host Bun 1.3.14; Electrobun 2.0.1 with bundled Bun 1.4.0.

## Executed checks

- `npm ci --ignore-scripts --offline`: passed using the already prepared pinned devkit.
- `npm run format:check` and `npm run lint`: passed with pinned Prettier and Oxlint.
- `npm test`: 35 tests passed, 147 assertions, no failures. Compile-only handler inference and rejection tests also passed through typecheck.
- `npm run typecheck`, `npm run check:exports`, and fresh renderer boundary checks: passed.
- Library and packed Notes consumer builds: passed.
- Both macOS native builds: passed, with only optional missing icon warnings.
- `npm run native:acceptance` and `npm run native:acceptance:notes`: passed semantic assertions, clean exit, and persistence after relaunch.
- Clean Notes installation outside the checkout: copied only application source, configuration, manifests, scripts, and the packed archive into a fresh temporary directory; `npm ci --ignore-scripts --offline`, `npm run prepare:native`, and `npm run build` passed without parent workspace dependencies. npm/devkit caches were available; this was not a cold-network installation test.
- Installed library source in both Notes installations matched `src` byte-for-byte. The reviewed archive contains 17 files, with SHA-1 `1476e40c3c3d119bf387fc34c5c7bb202712a9b9`.
- `git diff --check`: passed.

## Native acceptance

Todo covers add/toggle/delete across two windows, injected subscription failure becoming a React error snapshot, explicit recovery, independent filters, reload recovery, mutation after closing a window, rollback without invalidation, 17 seconds of idle without refetch, native quit, and four persisted rows after restart. The injected failure intentionally logs an error. Notes covers create/edit/delete in both windows, reload recovery, and the surviving edited note after restart. Notes uses `views://notes/index.html`, not the Todo view name. Latest retained report directory names: `erd-todo-acceptance-I9Irfy` and `erd-notes-acceptance-fDHYMf`.

These checks execute normal renderer APIs inside the packaged OS WebViews and inspect React snapshots. They do not certify human input handling, visual quality, signing, Windows, or Linux. Each command creates an isolated temporary database and prints retained report paths; no local machine paths or databases are committed.

Both apps assert expected row contents rather than simply recording `ok: true`. Negative tests verify missing rows, stale edits, and rollback invalidation fail. The runner also rejects absent reports, abnormal exits, and shutdown timeouts.

## Regressions fixed

- Concurrent initial connections: shared in-flight establishment and stale-response rejection.
- Failed transaction start: admission cleanup now covers BEGIN failure and permits shutdown.
- Unsupported mutation output: validation occurs before commit and rolls back on error.
- Subscription failure loop: submission stops on rejection; explicit query/refresh or a new subscription set can retry. Mutations are never automatically retried.
- Demo-specific navigation: local view-host rules derive from the initial URL; remote, credentialed, and wildcard hosts are rejected.
- Close-time WebView access: the native rerun exposed a TypeError after the SDK removed the view. Cleanup now uses the captured event name; the rerun passed.
- Subscription ordering: old desired-set acknowledgements and old-generation failures cannot clear or replace current health. Stop disconnects a connection that completes late; query reconnection failures retain the public `TRANSPORT` code.
- SQLite reconciliation: duplicate generated names are rejected, unrelated triggers survive, and failed schema changes roll back atomically. A 1,001-write test verifies consumption across the 500-row batch limit.
- React teardown: reverse-order provider-root cleanup now stops exactly once; Strict Mode, shared subscriptions, and parameter changes are tested with React DOM and a DOM test environment. Cache-key validation does not intentionally execute input accessors.

### Failure reproductions during implementation

On Node 26.7.0 / Bun 1.3.14, `bun test test/sqlite-reconcile.test.ts` initially failed the collision rejection and unrelated-trigger preservation assertions against the old wildcard/drop-before-validation implementation. The reconciliation diff adds preflight collision detection, explicit ownership checks, and one transaction; the same tests now pass.

`bun test test/react-lifecycle.test.tsx` reproduced reverse-order teardown leaving the stop count at 0 instead of 1. The cleanup-generation diff now assigns a generation when releasing a root and makes release idempotent. An earlier assertion requiring a final empty subscription submission was corrected: stopping legitimately cancels pending submission, so the test checks final stop and subscription uniqueness instead.

Public error delivery and DTO validation are documented in README.md, including pre-1.0 migration, byte accounting, and the distinction between async rejection and cancellation. Renderer checks now parse TypeScript imports/re-exports, traverse reachable local modules, and inspect fresh bundles; no additional package entry point was added.

Earlier native bootstrap failures revealed that Vite must use `electrobunViteAliases` from the prepared devkit. Accessibility automation was unavailable, so the native bridge harness was used. Earlier observation-only reports are not treated as automated assertions.

## Distribution scope

Source is published as an experimental MIT-licensed GitHub repository. npm publication is disabled. The packed consumer uses only public exports, and installed source was byte-compared against the library. Archives exclude tests, demos, databases, credentials, generated native builds, and devkits.

UI / visual candidate: yes — error snapshots affect the Todo example; human interaction and visual checks remain separate from native data-path tests.

## Remaining release gates

Implementation steps 1–4 of `docs/quality-and-api-design.md` are complete. The macOS GitHub Actions workflow is configured but has not been pushed or run on a hosted runner. Native GUI evidence is local only. Windows, Linux, signing/notarization, and human interaction are not certified. A real application's usage feedback, a successful hosted check run, and an explicit error/DTO compatibility and support-matrix review remain necessary before choosing 1.0.0. This work does not bump the version, publish npm packages, or push commits.
