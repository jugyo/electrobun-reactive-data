import { expect, test } from "bun:test";
import {
  LiveQueryRuntime,
  type ChangeFeed,
  type ChangeFeedHandlers,
} from "../src/client/core.js";

test("parameter variants refresh and disposal ignores late responses", async () => {
  let handlers!: ChangeFeedHandlers;
  let resolve!: (value: number) => void;
  const sets: string[][] = [];
  const feed: ChangeFeed = {
    setQueries(ids) {
      sets.push([...ids]);
    },
    start(value) {
      handlers = value;
    },
    stop() {},
  };
  const runtime = new LiveQueryRuntime(feed);
  const query = () =>
    new Promise<number>((done) => {
      resolve = done;
    });
  const a = runtime.getInstance("query.todos", query, { filter: "all" });
  const b = runtime.getInstance("query.todos", async () => 2, {
    filter: "active",
  });
  let calls = 0;
  const offA = a.subscribe(() => calls++);
  const offB = b.subscribe(() => calls++);
  expect(sets.at(-1)).toEqual(["query.todos"]);
  handlers.onNotifications({ queries: ["query.todos"] });
  offA();
  resolve(1);
  await Bun.sleep(0);
  expect(calls).toBeGreaterThanOrEqual(1);
  expect(a.getSnapshot().status).toBe("loading");
  offB();
  await Bun.sleep(0);
  expect(sets.at(-1)).toEqual([]);
  runtime.stop();
});
