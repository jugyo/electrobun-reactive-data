import { Utils } from "electrobun/main";
import {
  createReactiveData,
  defineApi,
  defineTrigger,
} from "@jugyo/electrobun-reactive-data/main";
import { createNotesApi } from "../src/bun/api.js";
import { assertNotesAcceptance, assertNotesPersistence } from "./assertions.js";

// This entrypoint is used only by the native-test build.
const data = createReactiveData({
  databasePath: process.env.ERD_NOTES_DATABASE,
  createApi(db) {
    const base = createNotesApi(db);
    return defineApi({
      ...base,
      mutation: {
        ...base.mutation,
        failAfterWrite: {
          run(_input: {}) {
            db.query(
              "INSERT INTO notes(title, body, updated_at) VALUES ('rollback probe', '', 0)",
            ).run();
            throw new Error("Intentional rollback probe");
          },
        },
      },
    });
  },
  triggers: [defineTrigger({ table: "notes" })],
});
export type NativeApi = typeof data.api;
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
else throw new Error("Native test entrypoint requires an acceptance phase");

async function runAcceptance(a: typeof first, b: typeof second) {
  const stages: Record<string, unknown> = {};
  const evidence: Record<string, unknown> = {
    runtime: `Bun ${Bun.version}`,
    stages,
  };
  try {
    await Promise.all([waitDom(a), waitDom(b)]);
    await command(
      a,
      'await window.__notesSmoke.create("native note","first body")',
    );
    await Bun.sleep(400);
    stages.created = await both(a, b);
    await command(a, "window.__notesSmoke.failSubscription()");
    await Bun.sleep(400);
    stages.subscriptionError = await snapshot(a);
    await command(a, "await window.__notesSmoke.recoverSubscription()");
    await Bun.sleep(400);
    stages.subscriptionRecovered = await snapshot(a);
    await command(b, 'await window.__notesSmoke.editFirst("edited body")');
    await Bun.sleep(400);
    stages.edited = await both(a, b);
    await command(
      a,
      'await window.__notesSmoke.create("other note","filter probe")',
    );
    await Bun.sleep(400);
    await command(a, 'window.__notesSmoke.search("native")');
    await command(b, 'window.__notesSmoke.search("other")');
    await Bun.sleep(400);
    stages.filters = await both(a, b);
    const reload = waitDom(a);
    a.webview.loadURL("views://notes/index.html");
    await reload;
    await command(
      b,
      'await window.__notesSmoke.create("after reload","persist me")',
    );
    await Bun.sleep(400);
    stages.reloaded = await both(a, b);
    await command(a, "await window.__notesSmoke.deleteFirst()");
    await Bun.sleep(400);
    stages.deleted = await both(a, b);
    a.close();
    await Bun.sleep(300);
    await command(b, 'window.__notesSmoke.search("")');
    await command(
      b,
      'await window.__notesSmoke.create("after close","still updating")',
    );
    await Bun.sleep(400);
    stages.beforeRollback = await snapshot(b);
    await command(b, "await window.__notesSmoke.rollback()");
    await Bun.sleep(400);
    stages.afterRollback = await snapshot(b);
    const before = await snapshot(b);
    await Bun.sleep(17_000);
    stages.idle = { before, after: await snapshot(b) };
    assertNotesAcceptance(stages);
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
