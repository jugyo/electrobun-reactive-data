# API safety and quality policy toward 1.0

Status: implementation steps 1–4 implemented; final distribution verification is recorded in VERIFICATION.md. Real-application feedback and the explicit 1.0 release review remain open. Updated: 2026-09-07.

## Decisions

1. Applications must be able to handle operation and subscription errors in their UI. Do not add a connection-status dashboard or a reconnection service merely to expose errors.
2. Reject common invalid handler types at compile time; enforce the actual wire contract at runtime. Type-level validation is assistance, not a security boundary.
3. Form state, typing ergonomics, optimistic updates, and edit conflicts belong to applications. They are not library features or prerequisites for 1.0.
4. Establish readable code, enforceable boundaries, regression coverage, and repeatable distribution checks before declaring stability.

This document preserves the design rationale, including descriptions of the original gaps. README.md describes the implemented public contract and migration. The package remains experimental; no version bump or npm publication is included.

## 1. UI-handled errors

### Current gap

Direct query/mutation calls reject promises. Live-query execution failures become error snapshots. However, `LiveQueryRuntime.sync()` currently assigns `console.error` as the feed error handler, so a failed subscription can leave an apparently successful but no-longer-updating query visible.

### Proposed public behavior

| Error source                                  | Delivery                                                                             | Recovery                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Direct `api.query.*` or `api.mutation.*` call | Reject with an Error instance                                                        | Caller catches the promise rejection                             |
| Query run through `useLiveQuery`              | Existing `status: "error"` and `error` fields                                        | `refresh()` attempts recovery                                    |
| Background connect/subscription failure       | Error snapshots for affected active live queries; optional client `onError` callback | Explicit refresh, a new subscription attempt, or document reload |
| Calling a stopped client                      | Reject the operation                                                                 | Create a new client                                              |

Add optional client options:

```ts
const { api, runtime } = createReactiveDataClient<AppApi>({
  onError(error) {
    // Optional application-level notification for background feed errors.
    // Per-query UI can use snapshot.error instead.
    reportBackgroundError(error);
  },
});
```

Keep operation errors out of this callback to avoid duplicating ordinary try/catch or hook error handling. One failed background attempt emits one callback, not one per query. Invoke callbacks outside internal state transitions; catch callback exceptions and report them without triggering more callbacks or retries. With no callback, snapshots remain the primary error surface; console logging is only a diagnostic fallback.

Expose `ReactiveDataError` and its code type through `/client`, not a new entry point. Preserve server codes (`INVALID_INPUT`, `UNKNOWN_OPERATION`, `STALE_SESSION`, `STOPPING`, `INTERNAL`); add client-side `TRANSPORT` and `STOPPED` codes. Preserve the original transport error as `cause` when available. Do not require string parsing to distinguish errors. Do not serialize arbitrary Error objects or stack traces into the RPC contract.

The minimal React usage remains:

```tsx
const result = useLiveQuery(api.query.notes, {});
if (result.status === "error") {
  return (
    <button onClick={() => void result.refresh()}>
      Retry: {result.error.message}
    </button>
  );
}
```

Retain the existing snapshot shape: errors expose no `data`. Retaining stale data alongside errors is deferred. `refresh()` continues to report live-query failures through the snapshot rather than introducing a second rejection channel; direct API promises reject. Specify that distinction in API documentation.

Do not throw from timers or asynchronous notification callbacks to reach React. Applications choosing an error boundary may throw the snapshot error during render themselves. No default render-time throwing and no `throwOnError` option are needed for this milestone.

### Failure-state ordering

An error notification alone is insufficient: an in-flight query must not overwrite a subscription failure with success while invalidation remains unavailable.

- Track feed health and an error epoch inside the runtime; associate failures with the current session generation and subscription revision.
- A shared connection failure affects all active queries. A subscription failure affects the relevant submitted set and any newly active query still awaiting acceptance. Prefer conservative error reporting if exact attribution is unavailable.
- Keep the failure sticky for unaccepted queries. Ignore late results and acknowledgements from obsolete generations/revisions.
- A matching subscription acknowledgement makes a query eligible for recovery and triggers a fresh read. Clear its visible error only when that read succeeds for the accepted generation.
- If a read completes before its subscription is accepted, do not present it as a healthy live result after a known feed failure.
- Refresh must actually attempt subscription recovery as well as querying. Failed recovery remains an error; do not spin automatically.
- No listener or callback fires after disposal. An unsubscribe/re-subscribe cannot hide an ongoing feed failure.

Mutation transport failures may occur after commit. Never automatically replay them or claim rollback solely because a promise rejected. Document that the application should inspect/refetch state before deciding to retry; idempotency keys are outside this milestone.

### Acceptance tests

Test actual feed + runtime integration: subscription failure reaches an existing successful snapshot; concurrent query completion cannot erase it; explicit retry requires both accepted subscription and successful read; late acknowledgements do not recover an obsolete generation; new active queries see the failure; callback delivery is once per attempt; throwing callbacks cannot corrupt the runtime; stop suppresses late events; mutation errors never cause replay. Add a native scenario injecting a subscription failure and observing the error/retry path in React.

## 2. Handler types and the wire contract

### Difficulty and implementation strategy

Difficulty is moderate if the goal is catching common errors, high if the goal is proving all JavaScript values serializable. We choose the former. Start with a compile-only spike and explicit examples before changing `defineApi`; do not sacrifice handler inference or introduce a schema-library dependency just to eliminate every escape hatch.

Keep the authoring surface `defineApi({ query, mutation })` and `typeof data.api`. Infer the concrete definition first, then apply mapped/conditional checks per handler. Preserve handler input/output literals and named interfaces. Do not constrain every interface to a string-indexed `JsonValue` record; ordinary DTO interfaces without index signatures must remain accepted.

The type checker should recursively inspect properties and array/tuple elements, rejecting known invalid members in a union rather than accepting the valid branch. Use bounded recursion; when the bound is reached, fail with guidance to use a simpler DTO rather than silently claiming validation. Include compiler performance and diagnostics in the spike's acceptance criteria. Overloaded/generic handlers whose concrete wire contract cannot be inferred require an explicit non-generic wrapper.

### Contract decisions

| Value                                                  | Policy                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| string, boolean, null                                  | Supported                                                           |
| number                                                 | Supported type; runtime requires finite values                      |
| Arrays, readonly arrays, tuples                        | Supported recursively; runtime rejects holes and undefined elements |
| Plain DTO objects, including named interfaces          | Supported recursively                                               |
| Optional object properties                             | May be absent; explicit undefined is rejected at runtime            |
| Promise/PromiseLike, async `run`, async `validate`     | Rejected                                                            |
| bigint, symbol, function, undefined/void results       | Rejected                                                            |
| Date, Map, Set, typed arrays, custom instances         | Rejected at runtime; reject statically recognizable built-ins       |
| Cycles, oversized values, excessive depth              | Rejected at runtime                                                 |
| `any`, unresolved `unknown`, casts, JavaScript callers | Not proof of validity; runtime checks remain mandatory              |

Keep no-input operations using the current explicit `{}` convention for this milestone; do not silently invent a new wire representation. Require mutation handlers without meaningful output to return `null` or a small JSON DTO, not `void`.

Raw wire input and output must be JSON-compatible. A validator receives `unknown`, narrows/normalizes it to the handler input DTO, and runs synchronously. Its normalized output must also satisfy the DTO policy. Do not pass class instances or database handles through validation as implicit context.

Reject top-level `any`/unresolved `unknown` at the definition boundary when practical and diagnosable; explicitly document that assertions or nested `any` can escape static checking. Never market this API as making invalid data impossible. Plain classes are structurally indistinguishable from some DTO types in TypeScript; runtime prototype checks are authoritative.

Examples required by the type spike:

```ts
interface Note {
  id: number;
  title: string;
  tag?: string;
}
// Accepted: (input: { id: number }) => Note | null
// Accepted: (input: {}) => readonly Note[]
// Rejected: async (input: {}) => []
// Rejected: (input: {}) => ({ id: 1n })
// Rejected: (input: {}) => new Date()
// Rejected: (input: {}) => undefined
// Rejected: a synchronous handler typed to return DTO | Promise<DTO>
```

No executable signature is frozen in this design: prove it using `@ts-expect-error` tests first, then select the smallest implementation that preserves inference. Do not add a public type-helper DSL unless the spike demonstrates a concrete need.

### Runtime enforcement

Replace reliance on `JSON.stringify`'s replacer with explicit validation before serialization. The current approach can silently convert Date via `toJSON` and non-finite numbers to null. Walk own data properties of plain objects and arrays; reject accessors, symbol keys, custom prototypes, cycles, excessive depth, and unsupported values without intentionally invoking getters/toJSON. A repeated reference without a cycle is allowed. No promises of protection against arbitrary side effects in hostile Proxy objects.

Validate caller input before RPC and again at the main dispatch boundary; validate normalized handler input before `run`. Validate/cache-key input before stable-key construction. For mutations, validate and serialize the output inside the transaction before COMMIT so conversion errors cannot be reported as a rolled-back write after commit. Return the prepared DTO representation rather than invoking user serialization twice. Apply the same output rules to queries.

Retain the existing 256 KiB encoded payload ceiling initially, define consistently whether envelope overhead counts, and add an explicit nesting limit (proposed 64). The implementation must document the chosen accounting in tests and error messages. Keep transaction, notification, and error-envelope behavior consistent across all rejection paths.

Async rejection is not cancellation: invoking an async handler can start work that continues after its returned Promise is rejected by the dispatcher. Reject identifiable async functions at definition time as defense in depth; continue checking thenables at invocation. State clearly that deliberately concealed asynchronous database work violates the synchronous-handler contract and cannot be undone by this guard.

### Migration and acceptance

This is a pre-1.0 tightening: serialize dates explicitly, convert database bigint IDs intentionally, return null instead of void, omit optional fields instead of assigning undefined, and move network/async work outside handlers. Document behavior changes before publishing a version.

Type tests must include nested unions, optional members, named interfaces, readonly tuples, input-validator alignment, async validators, nullable returns, and inference through `/client`. Runtime tests must cover prototype/toJSON handling, getters, cycles versus shared references, non-finite numbers, holes, Unicode byte limits, deep nesting, rollback/no invalidation, and plain JavaScript calls that bypass types. Packed-consumer typecheck must pass without importing internals.

## 3. Explicit non-goals

The library owns data operations and invalidation, not forms or collaborative editing. Remove typing ergonomics, cursor preservation, optimistic UI, and conflict resolution from the library's 1.0 acceptance gates. Keep examples understandable, but do not use demo UX concerns to expand the data-layer API. React tests remain necessary for the library-owned subscription and provider lifecycle, not for every application's editor behavior.

## 4. Maintenance and quality policy

### Formatting and linting

- Adopt Prettier for consistent formatting and Oxlint for static linting; pin exact versions when implementation begins.
- Format source, tests, scripts, and examples in a separate mechanical commit before behavioral changes. Do not mix wholesale formatting with semantic fixes.
- Add `format:check` and `lint` commands. Prefer readable functions and explicit types; avoid compressed one-line lifecycle and protocol logic.
- Do not force an arbitrary line-count or complexity target. Split code when it separates state transitions, validation, or resource ownership.
- Audit existing `any` uses. Permit narrowly documented RPC adaptation/internal generic erasure; avoid blanket disables or `any`-based public validation.

### Boundaries and tests

- Keep only `/main`, `/client`, and `/react` public. No new transport or shared-core extraction for this milestone.
- Replace regex-only source boundary checks with TypeScript-AST import/export checks that recognize type-only imports, runtime imports, dynamic imports, and re-exports. Traverse reachable local modules; inspect the fresh renderer bundle as a second defense.
- Keep unit tests focused on actual implementations, not copied algorithms. Use fake RPC/event adapters for controlled ordering and real bun:sqlite for transaction behavior.
- Add React lifecycle tests for Strict Mode, shared subscriptions, parameter changes, mount/unmount, and stale responses.
- Add SQLite tests for trigger-name collisions, exact ownership-prefix matching, atomic reconciliation failure, external-writer locks, and changes exceeding the 500-row consumption batch. Ensure unrelated triggers cannot be dropped by wildcard matching.
- Test disposal and owner recreation, including close events after native views disappear. Keep regression tests for every confirmed production-path bug.

### Verification and release gates

Run formatting, lint, typecheck, tests, boundary/export checks, and packed-consumer installation/build on pull requests. Establish a clean macOS runner with the pinned devkit for checks requiring Electrobun resolution. Do not assume a hosted runner provides a usable GUI session: native GUI acceptance remains a separately recorded local/manual release gate until automation is demonstrated there. Run no untrusted PR code with publishing credentials.

Keep native acceptance commands reproducible, assert semantics, and fail on missing reports or timeout. Separate environment failures from application failures. Preserve evidence without committing personal paths or databases. Do not add a percentage coverage target as a substitute for scenario coverage.

Before 1.0: declare the tested OS/runtime matrix, freeze the error and DTO contracts, demonstrate clean installation outside the development checkout, document migrations and compatibility, and exercise the library in a real application. macOS-only support is acceptable if explicit. Public GitHub source does not imply stable compatibility or npm publication.

### Implementation order

1. Mechanical formatting, pinned quality tools, and repeatable checks.
2. UI error propagation, error codes, failure-state ordering, and regression tests.
3. Compile-only handler-type spike, then runtime DTO enforcement and migration documentation.
4. SQLite/boundary/lifecycle audit and independent consumer verification.
5. Real-application feedback and an explicit 1.0 release review.

Do not implement automatic form handling, additional desktop frameworks, Cottontail support, npm publication, or a version bump as part of these steps.
