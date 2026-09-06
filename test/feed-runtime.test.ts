import { expect, test, spyOn } from "bun:test";
import {
  ElectrobunFeed,
  type ReactiveRpcClient,
} from "../src/client/electrobun-feed.js";
import { LiveQueryRuntime } from "../src/client/core.js";
import { ReactiveDataError } from "../src/client/errors.js";
import type { Envelope } from "../src/protocol.js";

test("subscription failure remains visible until acknowledgement and a fresh read", async () => {
  let rejectSubscription = true;
  let resolveRead!: (value: Envelope) => void;
  let delayRead = true;
  const errors: ReactiveDataError[] = [];
  const rpc: ReactiveRpcClient = {
    request: {
      connect: async () => ({ ok: true, value: { session: "s1" } }),
      setQueries: async ({ revision, queries }) => {
        if (rejectSubscription) throw new Error("subscription offline");
        return { ok: true, value: { revision, queries } };
      },
      invoke: async () =>
        delayRead
          ? new Promise((resolve) => {
              resolveRead = resolve;
            })
          : { ok: true, value: 2 },
      disconnect: async () => ({ ok: true, value: null }),
    },
    addMessageListener() {},
    removeMessageListener() {},
  };
  const feed = new ElectrobunFeed(rpc);
  const runtime = new LiveQueryRuntime(feed, (error) => errors.push(error));
  const item = runtime.getInstance(
    "query.notes",
    () => feed.invoke("query", "notes", {}),
    {},
  );
  item.subscribe(() => {});
  await Bun.sleep(0);
  expect(item.snapshot.status).toBe("error");
  expect(errors).toHaveLength(1);
  expect(errors[0]?.code).toBe("TRANSPORT");
  expect(errors[0]?.cause).toBeInstanceOf(Error);
  resolveRead({ ok: true, value: 1 });
  await Bun.sleep(0);
  expect(item.snapshot.status).toBe("error");
  rejectSubscription = false;
  delayRead = false;
  await item.refresh();
  await Bun.sleep(0);
  expect(item.snapshot).toMatchObject({ status: "success", data: 2 });
  runtime.stop();
  await expect(feed.invoke("mutation", "add", {})).rejects.toMatchObject({
    code: "STOPPED",
  });
});

test("throwing background callback is isolated and late events after stop are ignored", async () => {
  let handlers!: import("../src/client/core.js").ChangeFeedHandlers;
  let callbacks = 0;
  const log = spyOn(console, "error").mockImplementation(() => {});
  const runtime = new LiveQueryRuntime(
    {
      setQueries() {},
      start(value) {
        handlers = value;
      },
      stop() {},
    },
    () => {
      callbacks++;
      throw new Error("user callback");
    },
  );
  try {
    const item = runtime.getInstance("query.notes", async () => 1, {});
    item.subscribe(() => {});
    await Bun.sleep(0);
    handlers.onError(new Error("lost"));
    await Bun.sleep(0);
    expect(item.snapshot.status).toBe("error");
    expect(callbacks).toBe(1);
    const other = runtime.getInstance("query.notes", async () => 2, {
      page: 2,
    });
    other.subscribe(() => {});
    await Bun.sleep(0);
    expect(other.snapshot.status).toBe("error");
    handlers.onSubscribed(["query.notes"]);
    await Bun.sleep(0);
    expect(other.snapshot).toMatchObject({ status: "success", data: 2 });
    runtime.stop();
    handlers.onError(new Error("late"));
    await Bun.sleep(0);
    expect(callbacks).toBe(1);
  } finally {
    runtime.stop();
    log.mockRestore();
  }
});
