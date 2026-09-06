# Verification record

Date: 2026-09-06. Host: macOS arm64. Node 26.7.0; host Bun 1.3.14; Electrobun 2.0.1 with bundled Bun 1.4.0.

## Executed checks

- `npm ci --ignore-scripts --offline`: passed using the already prepared pinned devkit.
- `npm test`: 21 tests passed, 79 assertions, no failures.
- `npm run typecheck`, `npm run check:exports`, and fresh renderer boundary checks: passed.
- Library and packed Notes consumer builds: passed.
- Both macOS native builds: passed, with only optional missing icon warnings.
- `npm run native:acceptance` and `npm run native:acceptance:notes`: passed semantic assertions, clean exit, and persistence after relaunch.

## Native acceptance

Todo covers add/toggle/delete across two windows, independent filters, reload recovery, mutation after closing a window, rollback without invalidation, 17 seconds of idle without refetch, native quit, and four persisted rows after restart. Notes covers create/edit/delete in both windows, reload recovery, and the surviving edited note after restart. Notes uses `views://notes/index.html`, not the Todo view name.

These checks execute normal renderer APIs inside the packaged OS WebViews and inspect React snapshots. They do not certify human input handling, visual quality, signing, Windows, or Linux. Each command creates an isolated temporary database and prints retained report paths; no local machine paths or databases are committed.

Both apps assert expected row contents rather than simply recording `ok: true`. Negative tests verify missing rows, stale edits, and rollback invalidation fail. The runner also rejects absent reports, abnormal exits, and shutdown timeouts.

## Regressions fixed

- Concurrent initial connections: shared in-flight establishment and stale-response rejection.
- Failed transaction start: admission cleanup now covers BEGIN failure and permits shutdown.
- Unsupported mutation output: validation occurs before commit and rolls back on error.
- Subscription failure loop: submission stops on rejection; explicit query/refresh or a new subscription set can retry. Mutations are never automatically retried.
- Demo-specific navigation: local view-host rules derive from the initial URL; remote, credentialed, and wildcard hosts are rejected.
- Close-time WebView access: the native rerun exposed a TypeError after the SDK removed the view. Cleanup now uses the captured event name; the rerun passed.

Earlier native bootstrap failures revealed that Vite must use `electrobunViteAliases` from the prepared devkit. Accessibility automation was unavailable, so the native bridge harness was used. Earlier observation-only reports are not treated as automated assertions.

## Distribution scope

Source is published as an experimental MIT-licensed GitHub repository. npm publication is disabled. The packed consumer uses only public exports, and installed source was byte-compared against the library. Archives exclude tests, demos, databases, credentials, generated native builds, and devkits.

UI / visual candidate: yes — Todo and Notes are example applications; human interaction and visual checks remain separate from native data-path tests. No lint script or hosted CI exists; reproducible local commands are documented in CONTRIBUTING.md.
