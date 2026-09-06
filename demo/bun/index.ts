import { Database } from "bun:sqlite";
import { Utils } from "electrobun/main";
import { createReactiveData, defineApi, defineTrigger } from "../../src/main/index.js";
import type { TodoFilter } from "../shared.js";
import { assertTodoAcceptance, assertTodoPersistence } from "./acceptance.js";

const data = createReactiveData({
  databasePath: process.env.ERD_TODO_DATABASE,
  createApi(db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)))`);
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS native_smoke_reports (id INTEGER PRIMARY KEY, stage TEXT NOT NULL, window_id INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    return defineApi({
      query: {
        todos: {
          dependsOn: ["todos"],
          validate(input: unknown): { filter: TodoFilter } { if (!input || typeof input !== "object" || !("filter" in input) || !["all", "active", "completed"].includes(String(input.filter))) throw new Error("Invalid filter"); return input as { filter: TodoFilter }; },
          run({ filter }: { filter: TodoFilter }) {
            const where = filter === "all" ? "" : filter === "active" ? "WHERE done = 0" : "WHERE done = 1";
            return db.query<{ id: number; title: string; done: number }, []>(`SELECT id, title, done FROM todos ${where} ORDER BY id DESC`).all();
          },
        },
      },
      mutation: {
        addTodo: { validate: titleInput, run({ title }: { title: string }) { db.query("INSERT INTO todos(title) VALUES (?)").run(title); return { ok: true }; } },
        toggleTodo: { validate: idInput, run({ id }: { id: number }) { db.query("UPDATE todos SET done = NOT done WHERE id = ?").run(id); return { ok: true }; } },
        deleteTodo: { validate: idInput, run({ id }: { id: number }) { db.query("DELETE FROM todos WHERE id = ?").run(id); return { ok: true }; } },
        openWindow: { run(_input: {}) { openWindow(true); return { ok: true }; } },
        recordNativeSmoke: { validate: smokeInput, run(input: NativeSmokeInput) { db.query("INSERT INTO native_smoke_reports(stage, window_id, payload, created_at) VALUES (?, ?, ?, ?)").run(input.stage, input.windowId, JSON.stringify(input.payload), Date.now()); return { ok: true }; } },
        failAfterWrite: { run(_input: {}) { db.query("INSERT INTO todos(title) VALUES ('rollback probe')").run(); throw new Error("Intentional rollback probe"); } },
      },
    });
  },
  triggers: [defineTrigger({ table: "todos" })],
});

export type AppApi = typeof data.api;
const openWindow = (second = false) => data.createWindow({ title: second ? "Todos — second window" : "Todos", url: "views://mainview/index.html", frame: { width: 720, height: 680 } });
const firstWindow = openWindow();
const secondWindow = openWindow(true);
(globalThis as any).__openTodoWindow = () => openWindow(true);

if (process.env.ERD_NATIVE_ACCEPTANCE === "1") void runNativeAcceptance(firstWindow, secondWindow);
else if (process.env.ERD_NATIVE_VERIFY_PERSISTENCE === "1") void verifyNativePersistence(firstWindow, secondWindow);

function titleInput(input: unknown): { title: string } { if (!input || typeof input !== "object" || !("title" in input) || typeof input.title !== "string") throw new Error("Invalid title"); const title = input.title.trim(); if (!title || title.length > 200) throw new Error("Invalid title"); return { title }; }
function idInput(input: unknown): { id: number } { if (!input || typeof input !== "object" || !("id" in input) || !Number.isSafeInteger(input.id) || Number(input.id) < 1) throw new Error("Invalid id"); return { id: Number(input.id) }; }

type NativeSmokeInput = { stage: string; windowId: number; payload: unknown };
function smokeInput(input: unknown): NativeSmokeInput {
  if (!input || typeof input !== "object" || !("stage" in input) || typeof input.stage !== "string" || !("windowId" in input) || !Number.isSafeInteger(input.windowId) || !("payload" in input)) throw new Error("Invalid native smoke report");
  return input as NativeSmokeInput;
}

async function runNativeAcceptance(first: ReturnType<typeof openWindow>, second: ReturnType<typeof openWindow>): Promise<void> {
  const title = `native-${Date.now()}`;
  const evidence: Record<string, unknown> = { title, runtime: `Bun ${Bun.version}`, stages: {} };
  try {
    await Promise.all([waitForDom(first), waitForDom(second)]);
    const initial = await snapshots(first, second);
    if ((initial as any[]).some((item) => item?.missing)) throw new Error(`Renderer initialization failed: ${JSON.stringify(initial)}`);
    await command(first, `await window.__erdNativeSmoke.add(${JSON.stringify(title)})`); await Bun.sleep(500);
    (evidence.stages as any).afterAdd = await snapshots(first, second);
    await command(second, "await window.__erdNativeSmoke.toggleFirst()"); await Bun.sleep(500);
    (evidence.stages as any).afterToggle = await snapshots(first, second);
    await command(second, "await window.__erdNativeSmoke.deleteFirst()"); await Bun.sleep(500);
    (evidence.stages as any).afterDelete = await snapshots(first, second);
    await command(first, 'await window.__erdNativeSmoke.add("completed-filter")'); await Bun.sleep(300);
    await command(second, "await window.__erdNativeSmoke.toggleFirst()");
    await Bun.sleep(300); await command(first, 'await window.__erdNativeSmoke.add("active-filter")'); await Bun.sleep(500);
    await command(first, 'window.__erdNativeSmoke.setFilter("active")');
    await command(second, 'window.__erdNativeSmoke.setFilter("completed")'); await Bun.sleep(300);
    (evidence.stages as any).filters = await snapshots(first, second);
    const reloaded = waitForDom(first); first.webview.loadURL("views://mainview/index.html"); await reloaded;
    await command(second, 'await window.__erdNativeSmoke.add("after-reload")'); await Bun.sleep(500);
    (evidence.stages as any).afterReload = await snapshots(first, second);
    first.close(); await Bun.sleep(300);
    await command(second, 'await window.__erdNativeSmoke.add("after-close")');
    await command(second, 'window.__erdNativeSmoke.setFilter("all")'); await Bun.sleep(500);
    (evidence.stages as any).beforeRollback = await snapshot(second);
    await command(second, "await window.__erdNativeSmoke.rollback()"); await Bun.sleep(500);
    (evidence.stages as any).afterCloseAndRollback = await snapshot(second);
    const idleBefore = await snapshot(second); await Bun.sleep(17_000); const idleAfter = await snapshot(second);
    (evidence.stages as any).idle = { before: idleBefore, after: idleAfter };
    assertTodoAcceptance(title, evidence.stages as Record<string, unknown>);
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false; evidence.error = error instanceof Error ? error.stack : String(error);
  }
  if (process.env.ERD_NATIVE_REPORT) await Bun.write(process.env.ERD_NATIVE_REPORT, JSON.stringify(evidence, null, 2));
  Utils.quit();
}

async function verifyNativePersistence(first: ReturnType<typeof openWindow>, second: ReturnType<typeof openWindow>): Promise<void> {
  const evidence: Record<string, unknown> = { runtime: `Bun ${Bun.version}` };
  try { await Promise.all([waitForDom(first), waitForDom(second)]); evidence.windows = await snapshots(first, second); assertTodoPersistence(evidence.windows); evidence.ok = true; }
  catch (error) { evidence.ok = false; evidence.error = error instanceof Error ? error.stack : String(error); }
  if (process.env.ERD_NATIVE_REPORT) await Bun.write(process.env.ERD_NATIVE_REPORT, JSON.stringify(evidence, null, 2));
  Utils.quit();
}

function waitForDom(window: ReturnType<typeof openWindow>) { return new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`DOM ready timed out for window ${window.id}`)), 10_000); window.webview.on("dom-ready", () => { clearTimeout(timeout); setTimeout(resolve, 300); }); }); }
function command(window: ReturnType<typeof openWindow>, script: string): Promise<unknown> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const channel = commandChannel(window);
    const timeout = setTimeout(() => { channel.pending.delete(id); reject(new Error(`Native view command timed out: ${script}`)); }, 8_000);
    channel.pending.set(id, { resolve, reject, timeout });
    window.webview.executeJavascript(`Promise.resolve().then(async()=>{${script};return window.__erdNativeSmoke?window.__erdNativeSmoke.snapshot():{missing:true,ready:document.readyState,text:document.body.innerText,html:document.body.innerHTML,bootErrors:window.__erdBootErrors}}).then(value=>window.__electrobunSendToHost({id:${JSON.stringify(id)},ok:true,value})).catch(error=>window.__electrobunSendToHost({id:${JSON.stringify(id)},ok:false,error:String(error),bootErrors:window.__erdBootErrors,text:document.body.innerText}))`);
  });
}
type PendingCommand = { resolve(value: unknown): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };
const commandChannels = new WeakMap<object, { pending: Map<string, PendingCommand> }>();
function commandChannel(window: ReturnType<typeof openWindow>) {
  const existing = commandChannels.get(window); if (existing) return existing;
  const channel = { pending: new Map<string, PendingCommand>() };
  (window.webview as any).on("host-message", (event: any) => { let value: any = event?.data?.detail ?? event?.detail; try { if (typeof value === "string") value = JSON.parse(value); if (typeof value === "string") value = JSON.parse(value); } catch { return; } const pending = channel.pending.get(value?.id); if (!pending) return; channel.pending.delete(value.id); clearTimeout(pending.timeout); if (value.ok) pending.resolve(value.value); else pending.reject(new Error(JSON.stringify(value))); });
  commandChannels.set(window, channel); return channel;
}
function snapshot(window: ReturnType<typeof openWindow>) { return command(window, ""); }
function snapshots(a: ReturnType<typeof openWindow>, b: ReturnType<typeof openWindow>) { return Promise.all([snapshot(a), snapshot(b)]); }
