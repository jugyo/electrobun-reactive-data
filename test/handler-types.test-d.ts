import type { CheckedHandlers } from "../src/main/handler-types.js";
import { defineApi } from "../src/main/api.js";
// Compile-only spike before wiring checks into defineApi.
declare function check<const G>(group: G & CheckedHandlers<NoInfer<G>>): G;
interface Note {
  id: number;
  title: string;
  tag?: string;
}
check({ note: { run: (_input: { id: number }): Note | null => null } });
check({ notes: { run: (_input: {}): readonly Note[] => [] } });
check({
  tuple: { run: (_input: {}): readonly [number, string | null] => [1, null] },
});
// @ts-expect-error async handlers cannot hold a synchronous transaction
check({ bad: { run: async (_input: {}) => [] } });
// @ts-expect-error nested bigint
check({ bad: { run: (_input: {}) => ({ id: 1n }) } });
// @ts-expect-error built-in instances
check({ bad: { run: (_input: {}) => new Date() } });
// @ts-expect-error undefined outputs
check({ bad: { run: (_input: {}) => undefined } });
check({
  // @ts-expect-error reject the entire union if any member is invalid
  bad: {
    run: (_input: {}): Note | Promise<Note> =>
      Promise.resolve({ id: 1, title: "x" }),
  },
});
check({
  // @ts-expect-error async validators
  bad: { validate: async (_input: unknown) => ({}), run: (_input: {}) => null },
});
check({
  // @ts-expect-error validators must match handler input
  bad: {
    validate: (_input: unknown) => "x",
    run: (_input: { id: number }) => null,
  },
});
// @ts-expect-error unresolved unknown is not a DTO contract
check({ bad: { run: (_input: {}): unknown => null } });
// @ts-expect-error any is not a DTO contract
check({ bad: { run: (_input: {}): any => null } });

defineApi({
  query: {
    note: { dependsOn: ["notes"], run: (_input: {}): Note | null => null },
  },
  mutation: {},
});
defineApi({
  query: {},
  // @ts-expect-error public definition rejects async functions
  mutation: { bad: { run: async (_input: {}) => null } },
});
// @ts-expect-error public definition requires query dependencies
defineApi({ query: { bad: { run: (_input: {}) => null } }, mutation: {} });
defineApi({
  query: {},
  // @ts-expect-error public definition rejects nested invalid DTOs
  mutation: { bad: { run: (_input: {}) => ({ nested: [1n] }) } },
});
