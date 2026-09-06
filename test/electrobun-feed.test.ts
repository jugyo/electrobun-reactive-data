import { describe, expect, test } from "bun:test";
import {
  ElectrobunFeed,
  type ReactiveRpcClient,
} from "../src/client/electrobun-feed.js";
import type { ChangedMessage, Envelope } from "../src/protocol.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fakeRpc() {
  const connects: Array<
    ReturnType<typeof deferred<Envelope<{ session: string }>>>
  > = [];
  const subscriptions: Array<{
    params: { session: string; revision: number; queries: string[] };
    result: ReturnType<
      typeof deferred<Envelope<{ revision: number; queries: string[] }>>
    >;
  }> = [];
  const invokes: Array<{
    session: string;
    kind: "query" | "mutation";
    name: string;
    input: unknown;
  }> = [];
  const disconnects: string[] = [];
  const listeners = new Set<(message: ChangedMessage) => void>();
  const invokeResults: Array<Promise<Envelope>> = [];
  const rpc: ReactiveRpcClient = {
    request: {
      connect() {
        const result = deferred<Envelope<{ session: string }>>();
        connects.push(result);
        return result.promise;
      },
      invoke(params) {
        invokes.push(params);
        return (
          invokeResults.shift() ??
          Promise.resolve({ ok: true, value: params.input })
        );
      },
      setQueries(params) {
        const result =
          deferred<Envelope<{ revision: number; queries: string[] }>>();
        subscriptions.push({ params, result });
        return result.promise;
      },
      disconnect({ session }) {
        disconnects.push(session);
        return Promise.resolve({ ok: true, value: null });
      },
    },
    addMessageListener(_name, listener) {
      listeners.add(listener);
    },
    removeMessageListener(_name, listener) {
      listeners.delete(listener);
    },
  };
  return {
    rpc,
    connects,
    subscriptions,
    invokes,
    invokeResults,
    disconnects,
    listeners,
  };
}

const handlers = () => {
  const subscribed: string[][] = [];
  const notified: string[][] = [];
  const errors: unknown[] = [];
  return {
    value: {
      onSubscribed: (ids: readonly string[]) => subscribed.push([...ids]),
      onNotifications: (batch: { queries: string[] }) =>
        notified.push(batch.queries),
      onError: (error: unknown) => errors.push(error),
    },
    subscribed,
    notified,
    errors,
  };
};

describe("ElectrobunFeed", () => {
  test("query recovery wraps connection failures with a public transport code", async () => {
    const fake = fakeRpc();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.start(handlers().value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Bun.sleep(0);
    fake.invokeResults.push(
      Promise.resolve({
        ok: false,
        error: { code: "STALE_SESSION", message: "stale" },
      }),
    );
    const result = feed
      .invoke("query", "todos", {})
      .catch((error: unknown) => error);
    await Bun.sleep(0);
    fake.connects[1]!.reject(new Error("offline"));
    expect(await result).toMatchObject({
      name: "ReactiveDataError",
      code: "TRANSPORT",
      message: "offline",
    });
    feed.stop();
  });

  test("stale subscription reports once and ignores older-generation failures", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.start(events.value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Bun.sleep(0);
    fake.invokeResults.push(
      Promise.resolve({
        ok: false,
        error: { code: "STALE_SESSION", message: "stale" },
      }),
    );
    const query = feed.invoke("query", "todos", {});
    await Bun.sleep(0);
    fake.subscriptions[0]!.result.reject(new Error("obsolete"));
    await Bun.sleep(0);
    expect(events.errors).toEqual([]);
    fake.connects[1]!.resolve({ ok: true, value: { session: "s2" } });
    await query;
    fake.subscriptions[1]!.result.resolve({
      ok: false,
      error: { code: "STALE_SESSION", message: "stale" },
    });
    await Bun.sleep(0);
    expect(events.errors).toHaveLength(1);
    expect(events.errors[0]).toMatchObject({ code: "STALE_SESSION" });
    expect(fake.connects).toHaveLength(2);
    feed.stop();
  });

  test("permanent subscription rejection does not retry or survive stop", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.setQueries(["query.todos"]);
    feed.start(events.value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Bun.sleep(0);
    fake.subscriptions[0]!.result.resolve({
      ok: false,
      error: { code: "INVALID_INPUT", message: "invalid" },
    });
    await Bun.sleep(10);
    expect(fake.subscriptions).toHaveLength(1);
    expect(events.errors).toHaveLength(1);
    feed.stop();
    feed.setQueries(["query.other"]);
    await Bun.sleep(10);
    expect(fake.subscriptions).toHaveLength(1);
    expect(fake.listeners.size).toBe(0);
  });
  test("failed subscriptions stop until explicit work and can recover", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.setQueries(["query.todos"]);
    feed.start(events.value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Bun.sleep(0);
    fake.subscriptions[0]!.result.reject(new Error("offline"));
    await Bun.sleep(10);
    expect(fake.subscriptions).toHaveLength(1);
    expect(events.errors).toHaveLength(1);
    await feed.invoke("query", "todos", {});
    expect(fake.subscriptions).toHaveLength(2);
    fake.subscriptions[1]!.result.resolve({
      ok: true,
      value: { revision: 2, queries: ["query.todos"] },
    });
    await Bun.sleep(0);
    expect(events.subscribed).toEqual([["query.todos"]]);
    feed.stop();
  });
  test("shares initial connection between start and invoke", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.setQueries(["query.todos"]);
    feed.start(events.value);
    const invocation = feed.invoke("query", "todos", {});
    expect(fake.connects).toHaveLength(1);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Promise.resolve();
    expect(await invocation).toEqual({});
    expect(fake.invokes[0]?.session).toBe("s1");
  });

  test("serializes full-set replacements and ignores late notifications after stop", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.setQueries(["query.a"]);
    feed.start(events.value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Promise.resolve();
    expect(fake.subscriptions[0]?.params.queries).toEqual(["query.a"]);
    feed.setQueries(["query.b"]);
    expect(fake.subscriptions).toHaveLength(1);
    fake.subscriptions[0]!.result.resolve({
      ok: true,
      value: { revision: 1, queries: ["query.a"] },
    });
    await Bun.sleep(0);
    expect(fake.subscriptions[1]?.params.queries).toEqual(["query.b"]);
    expect(events.subscribed).toEqual([]);
    const listener = [...fake.listeners][0]!;
    feed.stop();
    listener({ session: "s1", queries: ["query.b"] });
    expect(events.notified).toEqual([]);
    expect(fake.listeners.size).toBe(0);
    expect(fake.disconnects).toEqual(["s1"]);
  });

  test("recovers a stale query once but never retries a rejected mutation", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.start(events.value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Promise.resolve();
    fake.invokeResults.push(
      Promise.resolve({
        ok: false,
        error: { code: "STALE_SESSION", message: "stale" },
      }),
    );
    const query = feed.invoke("query", "todos", {});
    await Bun.sleep(0);
    expect(fake.connects).toHaveLength(2);
    fake.connects[1]!.resolve({ ok: true, value: { session: "s2" } });
    expect(await query).toEqual({});
    expect(fake.invokes.map((item) => item.session)).toEqual(["s1", "s2"]);
    fake.invokeResults.push(Promise.reject(new Error("transport lost")));
    await expect(feed.invoke("mutation", "add", {})).rejects.toThrow(
      "transport lost",
    );
    expect(
      fake.invokes.filter((item) => item.kind === "mutation"),
    ).toHaveLength(1);
  });

  test("stop during connect rejects obsolete response and does not reconnect", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.start(events.value);
    const invocation = feed.invoke("query", "todos", {});
    feed.stop();
    fake.connects[0]!.resolve({ ok: true, value: { session: "late" } });
    await expect(invocation).rejects.toThrow(
      "Obsolete reactive data connection",
    );
    await expect(feed.invoke("query", "todos", {})).rejects.toThrow("stopped");
    expect(fake.connects).toHaveLength(1);
    expect(fake.listeners.size).toBe(0);
    expect(fake.disconnects).toEqual(["late"]);
  });

  test("reconnects and retries a query once after transport rejection", async () => {
    const fake = fakeRpc();
    const events = handlers();
    const feed = new ElectrobunFeed(fake.rpc);
    feed.start(events.value);
    fake.connects[0]!.resolve({ ok: true, value: { session: "s1" } });
    await Bun.sleep(0);
    fake.invokeResults.push(Promise.reject(new Error("transport lost")));
    const result = feed.invoke("query", "todos", { page: 1 });
    await Bun.sleep(0);
    expect(fake.connects).toHaveLength(2);
    fake.connects[1]!.resolve({ ok: true, value: { session: "s2" } });
    expect(await result).toEqual({ page: 1 });
    expect(fake.invokes.map((item) => item.session)).toEqual(["s1", "s2"]);
    feed.stop();
  });
});
