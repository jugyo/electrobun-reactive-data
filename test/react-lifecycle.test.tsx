import { expect, test } from "bun:test";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import {
  LiveQueryRuntime,
  type ChangeFeedHandlers,
} from "../src/client/core.js";
import { ReactiveDataProvider, useLiveQuery } from "../src/react/index.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("Strict Mode shares queries, replaces parameters, and stops on final unmount", async () => {
  let stopped = 0;
  let started = 0;
  const sets: string[][] = [];
  let handlers!: ChangeFeedHandlers;
  const runtime = new LiveQueryRuntime({
    setQueries(ids) {
      sets.push([...ids]);
    },
    start(value) {
      handlers = value;
      started++;
    },
    stop() {
      stopped++;
    },
  });
  let calls = 0;
  const query = Object.assign(
    async (input: { page: number }) => {
      calls++;
      return input.page;
    },
    { queryId: "query.notes" },
  );
  function View({ page }: { page: number }) {
    const result = useLiveQuery(query, { page });
    return (
      <span>{result.status === "success" ? result.data : result.status}</span>
    );
  }
  const tree = (page: number) => (
    <StrictMode>
      <ReactiveDataProvider runtime={runtime}>
        <View page={page} />
        <View page={page} />
      </ReactiveDataProvider>
    </StrictMode>
  );
  const browser = new Window();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browser,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browser.document,
  });
  const container = browser.document.createElement("div");
  browser.document.body.appendChild(container);
  const renderer = createRoot(container as unknown as HTMLElement);
  try {
    await act(async () => {
      renderer.render(tree(1));
    });
    expect(started).toBe(1);
    expect(stopped).toBe(0);
    expect(
      [...container.querySelectorAll("span")].map((node) => node.textContent),
    ).toEqual(["1", "1"]);
    const before = calls;
    await act(async () => {
      handlers.onNotifications({ queries: ["query.notes"] });
    });
    expect(calls - before).toBe(1);
    await act(async () => {
      renderer.render(tree(2));
    });
    expect(
      [...container.querySelectorAll("span")].map((node) => node.textContent),
    ).toEqual(["2", "2"]);
    await act(async () => {
      renderer.unmount();
    });
    expect(stopped).toBe(1);
    expect(sets.every((ids) => ids.length <= 1)).toBe(true);
  } finally {
    await act(async () => renderer.unmount());
    await browser.happyDOM.close();
    if (originalWindow)
      Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("root teardown works in reverse registration order and is idempotent", async () => {
  let stops = 0;
  const runtime = new LiveQueryRuntime({
    setQueries() {},
    start() {},
    stop() {
      stops++;
    },
  });
  const first = runtime.attachRendererRoot();
  const second = runtime.attachRendererRoot();
  second();
  await Bun.sleep(0);
  first();
  first();
  await Bun.sleep(0);
  expect(stops).toBe(1);
});
