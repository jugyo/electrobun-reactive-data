import "../src/mainview/main.js";
import { api, runtime } from "../src/mainview/client.js";
import type { NativeApi } from "./main.js";
import type { createReactiveDataClient } from "@jugyo/electrobun-reactive-data/client";

// Private access is deliberately confined to this test-only entrypoint.
const nativeApi = api as unknown as ReturnType<
  typeof createReactiveDataClient<NativeApi>
>["api"];
const feed = (
  runtime as unknown as {
    feed: {
      rpc: { request: Record<string, (...args: any[]) => Promise<unknown>> };
      desired: string[];
      setQueries(ids: string[]): void;
    };
  }
).feed;
const field = () =>
  document.querySelector<HTMLInputElement>('[aria-label="Search notes"]')!;
const item = () =>
  runtime.getInstance(api.query.notes.queryId, api.query.notes, {
    search: field().value,
  });
let restore: (() => void) | undefined;
(window as any).__notesSmoke = {
  create: (title: string, body: string) => api.mutation.create({ title, body }),
  editFirst: (body: string) => {
    const current = item().snapshot;
    if (current.status !== "success" || !current.data[0])
      throw new Error("No note to edit");
    return api.mutation.update({ ...current.data[0], body });
  },
  deleteFirst: () => {
    const current = item().snapshot;
    if (current.status !== "success" || !current.data[0])
      throw new Error("No note to delete");
    return api.mutation.remove({ id: current.data[0].id });
  },
  search: (value: string) => {
    const input = field();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  },
  failSubscription: () => {
    const rpc = feed.rpc;
    const desired = [...feed.desired];
    feed.rpc = new Proxy(rpc, {
      get(target, key) {
        if (key !== "request") return Reflect.get(target, key);
        return new Proxy(target.request, {
          get(request, method) {
            return method === "setQueries"
              ? async () => {
                  throw new Error("Injected subscription failure");
                }
              : Reflect.get(request, method);
          },
        });
      },
    });
    restore = () => {
      feed.rpc = rpc;
      feed.setQueries(desired);
    };
    feed.setQueries([]);
  },
  recoverSubscription: async () => {
    restore?.();
    await item().refresh();
  },
  rollback: async () => {
    try {
      await nativeApi.mutation.failAfterWrite({});
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Intentional rollback probe"
      )
        return;
      throw error;
    }
    throw new Error("Rollback probe unexpectedly succeeded");
  },
  snapshot: () => {
    const current = item().snapshot;
    return {
      status: current.status,
      refreshCount: current.refreshCount,
      error: current.status === "error" ? current.error.message : null,
      rows: current.status === "success" ? current.data : [],
      renderedRows: Array.from(document.querySelectorAll("article")).map(
        (article) => ({
          title: article.querySelector("input")!.value,
          body: article.querySelector("textarea")!.value,
        }),
      ),
      text: document.body.innerText,
    };
  },
};
