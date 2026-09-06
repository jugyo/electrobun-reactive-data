import { describe, expect, test } from "bun:test";
import { defineApi } from "../src/main/api.js";
import { SessionHub, type SessionEndpoint } from "../src/main/hub.js";
import { PROTOCOL_VERSION } from "../src/protocol.js";

function fixture() {
  const sent: Array<{ session: string; queries: string[] }> = [];
  const endpoint: SessionEndpoint = {
    sendChanged: (message) => sent.push(message),
  };
  let mutations = 0;
  const api = defineApi({
    query: {
      todos: { dependsOn: ["todos"], run: (_: {}) => [mutations] },
      settings: { dependsOn: ["settings"], run: (_: {}) => [] },
    },
    mutation: {
      add: {
        validate(input: unknown): number {
          if (typeof input !== "number") throw new Error("number required");
          return input;
        },
        run(value: number) {
          mutations += value;
          return mutations;
        },
      },
    },
  });
  const hub = new SessionHub(api, (run) => run());
  const connected = hub.connect(endpoint, PROTOCOL_VERSION);
  if (!connected.ok) throw new Error("connect failed");
  return { hub, endpoint, session: connected.value.session, sent };
}

describe("SessionHub", () => {
  test("replaces full subscriptions and fans out only dependencies", () => {
    const f = fixture();
    expect(
      f.hub.setQueries(f.endpoint, {
        session: f.session,
        revision: 1,
        queries: ["query.todos"],
      }).ok,
    ).toBe(true);
    f.hub.notify(["settings"]);
    expect(f.sent).toEqual([]);
    f.hub.notify(["todos"]);
    expect(f.sent[0]?.queries).toEqual(["query.todos"]);
    expect(
      f.hub.setQueries(f.endpoint, {
        session: f.session,
        revision: 0,
        queries: [],
      }),
    ).toEqual({ ok: true, value: { revision: 1, queries: ["query.todos"] } });
  });
  test("rejects stale sessions, inherited names, bad input, and malformed query sets", () => {
    const f = fixture();
    expect(
      f.hub.invoke(f.endpoint, {
        session: "old",
        kind: "query",
        name: "todos",
        input: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_SESSION" } });
    expect(
      f.hub.invoke(f.endpoint, {
        session: f.session,
        kind: "query",
        name: "toString",
        input: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "UNKNOWN_OPERATION" } });
    expect(
      f.hub.invoke(f.endpoint, {
        session: f.session,
        kind: "mutation",
        name: "add",
        input: "x",
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      f.hub.setQueries(f.endpoint, {
        session: f.session,
        revision: 1,
        queries: ["query.missing"],
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
  test("a failed send does not block another session", () => {
    const f = fixture();
    const healthy: any[] = [];
    const broken: SessionEndpoint = {
      sendChanged() {
        throw new Error("closed");
      },
    };
    const connection = f.hub.connect(broken, PROTOCOL_VERSION);
    if (!connection.ok) throw new Error();
    f.hub.setQueries(broken, {
      session: connection.value.session,
      revision: 1,
      queries: ["query.todos"],
    });
    f.hub.setQueries(f.endpoint, {
      session: f.session,
      revision: 1,
      queries: ["query.todos"],
    });
    f.endpoint.sendChanged = (message) => healthy.push(message);
    f.hub.notify(["todos"]);
    expect(healthy).toHaveLength(1);
  });
  test("new connect invalidates the former generation", () => {
    const f = fixture();
    const old = f.session;
    const next = f.hub.connect(f.endpoint, PROTOCOL_VERSION);
    expect(next.ok).toBe(true);
    expect(
      f.hub.invoke(f.endpoint, {
        session: old,
        kind: "query",
        name: "todos",
        input: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_SESSION" } });
    expect(f.hub.sessionCount).toBe(1);
  });
});
