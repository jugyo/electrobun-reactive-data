import { Utils } from "electrobun/main";
import { assertNotesAcceptance, assertNotesPersistence } from "./acceptance.js";
import {
  createReactiveData,
  defineApi,
  defineTrigger,
} from "@jugyo/electrobun-reactive-data/main";

const data = createReactiveData({
  databasePath: process.env.ERD_NOTES_DATABASE,
  createApi(db) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS native_reports(id INTEGER PRIMARY KEY, stage TEXT NOT NULL, window_id INTEGER NOT NULL, payload TEXT NOT NULL)",
    );
    return defineApi({
      query: {
        notes: {
          dependsOn: ["notes"],
          run: (_input: {}) =>
            db
              .query<
                { id: number; title: string; body: string; updatedAt: number },
                []
              >(
                "SELECT id, title, body, updated_at AS updatedAt FROM notes ORDER BY updated_at DESC, id DESC",
              )
              .all(),
        },
      },
      mutation: {
        create: {
          validate: noteInput,
          run(input: NoteInput) {
            db.query(
              "INSERT INTO notes(title, body, updated_at) VALUES (?, ?, ?)",
            ).run(input.title, input.body, Date.now());
            return { ok: true };
          },
        },
        update: {
          validate: updateInput,
          run(input: NoteInput & { id: number }) {
            db.query(
              "UPDATE notes SET title=?, body=?, updated_at=? WHERE id=?",
            ).run(input.title, input.body, Date.now(), input.id);
            return { ok: true };
          },
        },
        remove: {
          validate: idInput,
          run({ id }: { id: number }) {
            db.query("DELETE FROM notes WHERE id=?").run(id);
            return { ok: true };
          },
        },
        report: {
          validate: reportInput,
          run(input: ReportInput) {
            db.query(
              "INSERT INTO native_reports(stage, window_id, payload) VALUES (?, ?, ?)",
            ).run(input.stage, input.windowId, JSON.stringify(input.payload));
            return { ok: true };
          },
        },
      },
    });
  },
  triggers: [defineTrigger({ table: "notes" })],
});
export type NotesApi = typeof data.api;

const open = (title: string) =>
  data.createWindow({
    title,
    url: "views://notes/index.html",
    frame: { width: 680, height: 620 },
  });
const first = open("Notes");
const second = open("Notes — second window");
type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};
const channels = new WeakMap<object, { pending: Map<string, Pending> }>();
if (process.env.ERD_NATIVE_ACCEPTANCE === "1")
  void runAcceptance(first, second);
else if (process.env.ERD_NATIVE_VERIFY_PERSISTENCE === "1")
  void verifyPersistence(first, second);

type NoteInput = { title: string; body: string };
function noteInput(input: unknown): NoteInput {
  if (
    !input ||
    typeof input !== "object" ||
    !("title" in input) ||
    typeof input.title !== "string" ||
    !("body" in input) ||
    typeof input.body !== "string"
  )
    throw new Error("Invalid note");
  const title = input.title.trim();
  if (!title || title.length > 120 || input.body.length > 10_000)
    throw new Error("Invalid note");
  return { title, body: input.body };
}
function idInput(input: unknown): { id: number } {
  if (
    !input ||
    typeof input !== "object" ||
    !("id" in input) ||
    !Number.isSafeInteger(input.id)
  )
    throw new Error("Invalid id");
  return { id: Number(input.id) };
}
function updateInput(input: unknown): NoteInput & { id: number } {
  return { ...noteInput(input), ...idInput(input) };
}
type ReportInput = { stage: string; windowId: number; payload: unknown };
function reportInput(input: unknown): ReportInput {
  if (
    !input ||
    typeof input !== "object" ||
    !("stage" in input) ||
    typeof input.stage !== "string" ||
    !("windowId" in input) ||
    !Number.isSafeInteger(input.windowId) ||
    !("payload" in input)
  )
    throw new Error("Invalid report");
  return input as ReportInput;
}
async function runAcceptance(a: typeof first, b: typeof second) {
  const evidence: Record<string, unknown> = {
    runtime: `Bun ${Bun.version}`,
    stages: {},
  };
  try {
    await Promise.all([waitDom(a), waitDom(b)]);
    await command(
      a,
      'await window.__notesSmoke.create("native note","first body")',
    );
    await Bun.sleep(400);
    (evidence.stages as any).created = await both(a, b);
    await command(b, 'await window.__notesSmoke.editFirst("edited body")');
    await Bun.sleep(400);
    (evidence.stages as any).edited = await both(a, b);
    const reload = waitDom(a);
    a.webview.loadURL("views://notes/index.html");
    await reload;
    await command(
      b,
      'await window.__notesSmoke.create("after reload","persist me")',
    );
    await Bun.sleep(400);
    (evidence.stages as any).reloaded = await both(a, b);
    await command(b, "await window.__notesSmoke.deleteFirst()");
    await Bun.sleep(400);
    (evidence.stages as any).deleted = await both(a, b);
    assertNotesAcceptance(evidence.stages as Record<string, unknown>);
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.error = error instanceof Error ? error.stack : String(error);
  }
  await writeEvidence(evidence);
  Utils.quit();
}
async function verifyPersistence(a: typeof first, b: typeof second) {
  const evidence: Record<string, unknown> = { runtime: `Bun ${Bun.version}` };
  try {
    await Promise.all([waitDom(a), waitDom(b)]);
    evidence.windows = await both(a, b);
    assertNotesPersistence(evidence.windows);
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.error = error instanceof Error ? error.stack : String(error);
  }
  await writeEvidence(evidence);
  Utils.quit();
}
function writeEvidence(value: unknown) {
  return process.env.ERD_NATIVE_REPORT
    ? Bun.write(process.env.ERD_NATIVE_REPORT, JSON.stringify(value, null, 2))
    : Promise.resolve(0);
}
function waitDom(window: typeof first) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`DOM ready timeout ${window.id}`)),
      10_000,
    );
    window.webview.on("dom-ready", () => {
      clearTimeout(timeout);
      setTimeout(resolve, 300);
    });
  });
}
function channel(window: typeof first) {
  const old = channels.get(window);
  if (old) return old;
  const next = { pending: new Map<string, Pending>() };
  (window.webview as any).on("host-message", (event: any) => {
    let value: any = event?.data?.detail ?? event?.detail;
    try {
      if (typeof value === "string") value = JSON.parse(value);
      if (typeof value === "string") value = JSON.parse(value);
    } catch {
      return;
    }
    const item = next.pending.get(value?.id);
    if (!item) return;
    next.pending.delete(value.id);
    clearTimeout(item.timeout);
    if (value.ok) item.resolve(value.value);
    else item.reject(new Error(JSON.stringify(value)));
  });
  channels.set(window, next);
  return next;
}
function command(window: typeof first, script: string) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const current = channel(window);
    const timeout = setTimeout(() => {
      current.pending.delete(id);
      reject(new Error(`command timeout: ${script}`));
    }, 8_000);
    current.pending.set(id, { resolve, reject, timeout });
    window.webview.executeJavascript(
      `Promise.resolve().then(async()=>{${script};return window.__notesSmoke?window.__notesSmoke.snapshot():{missing:true,errors:window.__notesBootErrors,text:document.body.innerText}}).then(value=>window.__electrobunSendToHost({id:${JSON.stringify(id)},ok:true,value})).catch(error=>window.__electrobunSendToHost({id:${JSON.stringify(id)},ok:false,error:String(error),errors:window.__notesBootErrors}))`,
    );
  });
}
function snapshot(window: typeof first) {
  return command(window, "");
}
function both(a: typeof first, b: typeof second) {
  return Promise.all([snapshot(a), snapshot(b)]);
}
