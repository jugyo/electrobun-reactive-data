import type { CheckedHandlers } from "./handler-types.js";

// Internal existential handler types are erased only for dispatcher storage.
export interface QueryHandler<Input = any, Output = any> {
  readonly dependsOn: readonly string[];
  readonly validate?: (input: unknown) => Input;
  run(input: Input): Output;
}

export interface MutationHandler<Input = any, Output = any> {
  readonly validate?: (input: unknown) => Input;
  run(input: Input): Output;
}

export type ApiDefinition = {
  query: Record<string, QueryHandler>;
  mutation: Record<string, MutationHandler>;
};

export function defineApi<const Q, const M>(api: {
  query: Q & CheckedHandlers<NoInfer<Q>, true>;
  mutation: M & CheckedHandlers<NoInfer<M>>;
}): { query: Q; mutation: M } {
  assertSynchronousHandlers(api as unknown as ApiDefinition);
  return api;
}

export function assertSynchronousHandlers(api: ApiDefinition): void {
  for (const group of [api.query, api.mutation]) {
    for (const handler of Object.values(group)) {
      for (const fn of [handler.run, handler.validate]) {
        if (
          fn &&
          Object.prototype.toString.call(fn) === "[object AsyncFunction]"
        )
          throw new Error("Async handlers are not supported");
      }
    }
  }
}
