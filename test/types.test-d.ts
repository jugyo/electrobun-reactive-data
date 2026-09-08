import { createReactiveDataClient } from "../src/client/index.js";
import { defineApi } from "../src/main/api.js";
const definition = defineApi({
  query: {
    todos: {
      dependsOn: ["todos"],
      run: (_input: { filter: "all" | "active" }) => [] as { title: string }[],
    },
  },
  mutation: { addTodo: { run: (_input: { title: string }) => ({ ok: true }) } },
});
type AppApi = typeof definition;
const { api } = createReactiveDataClient<AppApi>();
api.mutation.addTodo({ title: "valid" });
// @ts-expect-error title must be a string
api.mutation.addTodo({ title: 42 });
// @ts-expect-error filter is a closed union
api.query.todos({ filter: "unknown" });
