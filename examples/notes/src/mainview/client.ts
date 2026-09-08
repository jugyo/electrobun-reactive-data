import { createReactiveDataClient } from "@jugyo/electrobun-reactive-data/client";
import type { NotesApi } from "../bun/index.js";
export const { api, runtime } = createReactiveDataClient<NotesApi>();
