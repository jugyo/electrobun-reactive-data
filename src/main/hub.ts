import type { ApiDefinition } from "./api.js";
import { MAX_QUERIES, PROTOCOL_VERSION, assertWireValue, type ChangedMessage, type Envelope, type InvokeParams, type SetQueriesParams } from "../protocol.js";

export interface SessionEndpoint { sendChanged(message: ChangedMessage): void; }
type Session = { token: string; revision: number; queries: Set<string>; endpoint: SessionEndpoint };
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (code: "INVALID_INPUT" | "UNKNOWN_OPERATION" | "STALE_SESSION" | "STOPPING" | "INTERNAL", message: string): Envelope => ({ ok: false, error: { code, message } });

export class SessionHub {
  private sessions = new Map<string, Session>();
  private generations = new Map<SessionEndpoint, string>();
  private sequence = 0;
  private stopping = false;
  constructor(private readonly api: ApiDefinition, private readonly mutate: (run: () => unknown) => unknown) {}

  connect(endpoint: SessionEndpoint, protocolVersion: number): Envelope<{ session: string }> {
    if (this.stopping) return fail("STOPPING", "Reactive data is stopping") as Envelope<{ session: string }>;
    if (protocolVersion !== PROTOCOL_VERSION) return fail("INVALID_INPUT", `Unsupported protocol version: ${protocolVersion}`) as Envelope<{ session: string }>;
    this.detach(endpoint);
    const token = `${Date.now().toString(36)}-${++this.sequence}-${crypto.randomUUID()}`;
    this.sessions.set(token, { token, revision: -1, queries: new Set(), endpoint });
    this.generations.set(endpoint, token);
    return { ok: true, value: { session: token } };
  }

  invoke(endpoint: SessionEndpoint, params: InvokeParams): Envelope {
    if (this.stopping) return fail("STOPPING", "Reactive data is stopping");
    const session = this.current(endpoint, params.session);
    if (!session) return fail("STALE_SESSION", "The renderer session is stale");
    if (params.kind !== "query" && params.kind !== "mutation") return fail("INVALID_INPUT", "Invalid operation kind");
    try { assertWireValue(params); } catch (error) { return fail("INVALID_INPUT", error instanceof Error ? error.message : String(error)); }
    const group = this.api[params.kind];
    if (!own(group, params.name)) return fail("UNKNOWN_OPERATION", `Unknown ${params.kind}: ${params.name}`);
    const handler = group[params.name]!;
    let input: unknown;
    try {
      input = handler.validate ? handler.validate(params.input) : params.input;
    } catch (error) {
      return fail("INVALID_INPUT", error instanceof Error ? error.message : String(error));
    }
    try {
      const value = params.kind === "mutation" ? this.mutate(() => handler.run(input)) : handler.run(input);
      if (value && typeof (value as any).then === "function") throw new Error("Async handlers are not supported");
      assertWireValue(value);
      return { ok: true, value };
    } catch (error) {
      return fail("INTERNAL", error instanceof Error ? error.message : String(error));
    }
  }

  setQueries(endpoint: SessionEndpoint, params: SetQueriesParams): Envelope<{ revision: number; queries: string[] }> {
    const session = this.current(endpoint, params.session);
    if (!session) return fail("STALE_SESSION", "The renderer session is stale") as Envelope<{ revision: number; queries: string[] }>;
    if (!Number.isSafeInteger(params.revision) || params.revision < 0 || !Array.isArray(params.queries) || params.queries.length > MAX_QUERIES || params.queries.some((id) => typeof id !== "string" || id.length > 200 || !id.startsWith("query.") || !own(this.api.query, id.slice(6)))) {
      return fail("INVALID_INPUT", "Malformed query subscription set") as Envelope<{ revision: number; queries: string[] }>;
    }
    if (params.revision >= session.revision) {
      session.revision = params.revision;
      session.queries = new Set(params.queries);
    }
    return { ok: true, value: { revision: session.revision, queries: [...session.queries].sort() } };
  }

  disconnect(endpoint: SessionEndpoint, token: string): Envelope<null> {
    if (this.current(endpoint, token)) this.detach(endpoint);
    return { ok: true, value: null };
  }
  detach(endpoint: SessionEndpoint): void { const token = this.generations.get(endpoint); if (token) this.sessions.delete(token); this.generations.delete(endpoint); }
  notify(triggerIds: readonly string[]): void {
    const affected = new Set(Object.entries(this.api.query).filter(([, query]) => query.dependsOn.some((table) => triggerIds.includes(table))).map(([name]) => `query.${name}`));
    for (const session of [...this.sessions.values()]) {
      const queries = [...session.queries].filter((id) => affected.has(id));
      if (!queries.length) continue;
      try { session.endpoint.sendChanged({ session: session.token, queries }); } catch { /* another session still receives its message */ }
    }
  }
  stop(): void { this.stopping = true; this.sessions.clear(); this.generations.clear(); }
  get sessionCount(): number { return this.sessions.size; }
  private current(endpoint: SessionEndpoint, token: string): Session | undefined { return this.generations.get(endpoint) === token ? this.sessions.get(token) : undefined; }
}
