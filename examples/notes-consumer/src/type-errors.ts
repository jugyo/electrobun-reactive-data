import { createReactiveDataClient } from "@jugyo/electrobun-reactive-data/client";
import type { NotesApi } from "./bun/index.js";
const { api } = createReactiveDataClient<NotesApi>();
// @ts-expect-error create requires a string title
api.mutation.create({ title: 42, body: "invalid" });
// @ts-expect-error update requires an id
api.mutation.update({ title: "missing id", body: "invalid" });
