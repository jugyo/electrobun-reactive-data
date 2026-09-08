import {
  createReactiveData,
  defineTrigger,
} from "@jugyo/electrobun-reactive-data/main";
import { createNotesApi } from "./api.js";

const data = createReactiveData({
  databasePath: process.env.ERD_NOTES_DATABASE,
  createApi: createNotesApi,
  triggers: [defineTrigger({ table: "notes" })],
});
export type NotesApi = ReturnType<typeof createNotesApi>;

for (const title of ["Notes", "Notes — second window"])
  data.createWindow({
    title,
    url: "views://notes/index.html",
    frame: { width: 680, height: 620 },
  });
