import type { Database } from "bun:sqlite";
import { join } from "node:path";
import Electrobun, { BrowserView, BrowserWindow, Utils, type WindowOptionsType } from "electrobun/main";
import { defineApi, type ApiDefinition } from "./api.js";
import { defineTrigger, type TriggerDefinition } from "./sqlite.js";
import type { SessionEndpoint } from "./hub.js";
import { createDataOwner } from "./owner.js";
import { navigationRulesFor } from "./navigation.js";
import { PROTOCOL_VERSION, type ReactiveRpcSchema } from "../protocol.js";

export { defineApi, defineTrigger, PROTOCOL_VERSION };
export type { ApiDefinition, TriggerDefinition };

export interface ReactiveDataOptions<A extends ApiDefinition> {
  databasePath?: string;
  createApi(db: Database): A;
  triggers: readonly TriggerDefinition[];
  handleQuit?: boolean;
  pollIntervalMs?: number;
}
export type ReactiveWindowOptions = Omit<Partial<WindowOptionsType<any>>, "rpc" | "url"> & { title: string; url: string };

export function createReactiveData<A extends ApiDefinition>(options: ReactiveDataOptions<A>) {
  const databasePath = options.databasePath ?? join(Utils.paths.userData, "reactive-data.sqlite");
  const owner = createDataOwner({ databasePath, createApi: options.createApi, triggers: options.triggers, pollIntervalMs: options.pollIntervalMs });
  const { api, hub } = owner;
  const windows = new Map<number, { window: BrowserWindow<any>; endpoint: SessionEndpoint; navigationEvent: string; navigationHandler: () => void }>();

  const onClose = (event: { data?: { id?: number } }) => {
    const owned = windows.get(event.data?.id ?? -1);
    if (owned) { hub.detach(owned.endpoint); Electrobun.events.off(owned.navigationEvent, owned.navigationHandler); windows.delete(owned.window.id); }
  };
  Electrobun.events.on("close", onClose);

  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = owner.stop().then(() => {
      if (options.handleQuit !== false) Electrobun.events.off("before-quit", onBeforeQuit);
      for (const { endpoint, navigationEvent, navigationHandler } of windows.values()) { hub.detach(endpoint); Electrobun.events.off(navigationEvent, navigationHandler); }
      windows.clear();
      Electrobun.events.off("close", onClose);
    });
    return stopPromise;
  };

  let quitPassing = false;
  const onBeforeQuit = (event: { response?: { allow: boolean } }) => {
    if (quitPassing) return;
    event.response = { allow: false };
    void stop().then(() => { quitPassing = true; Utils.quit(); }).catch((error) => console.error("Reactive data shutdown failed; quit remains vetoed", error));
  };
  if (options.handleQuit !== false) Electrobun.events.on("before-quit", onBeforeQuit);

  function createWindow(windowOptions: ReactiveWindowOptions): BrowserWindow<any> {
    if (owner.state !== "running") throw new Error("Reactive data is stopping");
    const navigationRules = navigationRulesFor(windowOptions.url);
    let rpc: any;
    const endpoint: SessionEndpoint = { sendChanged: (message) => rpc.send.changed(message) };
    rpc = BrowserView.defineRPC<ReactiveRpcSchema>({
      maxRequestTime: 10_000,
      handlers: {
        requests: {
          connect: ({ protocolVersion }) => hub.connect(endpoint, protocolVersion),
          invoke: (params) => hub.invoke(endpoint, params),
          setQueries: (params) => hub.setQueries(endpoint, params),
          disconnect: ({ session }) => hub.disconnect(endpoint, session),
        },
        messages: {},
      },
    });
    const window = new BrowserWindow({ ...windowOptions, rpc, sandbox: false, navigationRules });
    const navigationHandler = () => hub.detach(endpoint);
    windows.set(window.id, { window, endpoint, navigationEvent: `did-commit-navigation-${window.webview.id}`, navigationHandler });
    window.webview.on("did-commit-navigation", navigationHandler);
    return window;
  }

  return { api, databasePath, createWindow, stop, get state() { return owner.state; } };
}
