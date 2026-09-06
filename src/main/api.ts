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

export function defineApi<
  const Q extends Record<string, QueryHandler>,
  const M extends Record<string, MutationHandler>,
>(api: { query: Q; mutation: M }): { query: Q; mutation: M } {
  return api;
}
