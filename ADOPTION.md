# Adoption assessment

## Outcome

Continue the library as an independent, deliberately narrow Electrobun package. The Notes consumer demonstrated that the current API removes meaningful transport, subscription, fan-out, transaction, and shutdown infrastructure without requiring application-specific workarounds or internal imports. It is not a stable production release: the synchronous-handler constraint and dedicated-window RPC ownership should remain explicit while more applications exercise them.

## What an application author writes

The Notes consumer supplies its schema SQL, query and mutation handlers, input validators, trigger declarations, window titles, React components, styles, and Electrobun/Vite configuration. The application does not implement an HTTP/WebSocket listener, RPC schema, session tokens, reconnect policy, subscription revisions, cache invalidation, SQLite transaction wrapper, change-log consumption, multi-window fan-out, or quit draining.

Setup consists of installing the packed package plus its declared React and Electrobun peers, preparing the pinned Electrobun devkit, adding the required devkit aliases to Vite, defining one `createReactiveData` owner in the Bun entry point, and creating one renderer client per document. The consumer imports only `/main`, `/client`, and `/react`.

Application code is schema, handlers, validation, and React UI; native acceptance code is separate verification overhead. Physical line counts are not a useful simplicity measure because the early demo is densely formatted. No RPC/session implementation is copied into Notes. General connection, transaction, packaging, and Vite integration corrections were discovered through the consumer.

## Friction observed

- External Vite builds must use `electrobunViteAliases` from the prepared Hutch devkit. Omitting it silently bundles the npm bootstrap stub and fails only in the native WebView. This must stay prominent in setup documentation.
- Each library-created window owns a dedicated RPC instance. This makes the safe path simple, but applications needing to merge unrelated RPC methods cannot yet compose them through the public API.
- Query and mutation handlers must remain synchronous because one Bun-owned SQLite transaction cannot cross an `await`. Network work must happen outside handlers.
- Consumers must declare `electrobun`, `react`, and `react-dom` themselves. The library declares Electrobun and React as peers; React DOM is application-owned.
- The package currently ships TypeScript source. Hutch/Bun and Vite consume it correctly, but a future public package should decide whether to ship generated declarations and JavaScript.

## Recommendation

Continue independently and keep the API narrow. Before a stable release decision, add one more non-demo application and decide whether RPC composition is genuinely needed. Do not generalize transports or async database handlers based on the present evidence. Native Todo and independently packed Notes flows both passed two-window mutation, reload, persistence, and quit checks on macOS arm64, which is stronger evidence than package size or compilation alone.

The follow-up hardening removes the retry loop and hard-coded view name, adds semantic native assertions, and fixes a removed-WebView cleanup error found by rerunning acceptance. Proceed with experimental use in a real application; the package boundary and local packed-consumer workflow are established. The source is public on GitHub under MIT; npm publication remains a separate decision. See VERIFICATION.md for the distinction between native data-path validation and human interaction testing.
