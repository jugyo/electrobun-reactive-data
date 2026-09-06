import { createReactiveDataClient } from "../src/client/index.js";
import type { AppApi } from "../demo/bun/index.js";
const { api } = createReactiveDataClient<AppApi>();
api.mutation.addTodo({ title: "valid" });
// @ts-expect-error title must be a string
api.mutation.addTodo({ title: 42 });
// @ts-expect-error filter is a closed union
api.query.todos({ filter: "unknown" });
