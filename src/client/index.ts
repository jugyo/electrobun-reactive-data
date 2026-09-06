import { Electroview } from "electrobun/view";
import type { ReactiveRpcSchema } from "../protocol.js";
import { LiveQueryRuntime } from "./core.js";
import { ElectrobunFeed, type ReactiveRpcClient } from "./electrobun-feed.js";

type Handler<I, O> = { validate?: (input: unknown) => I; run(input: I): O; dependsOn?: readonly string[] };
type Contract = { query: Record<string, Handler<any, any>>; mutation: Record<string, Handler<any, any>> };
type InputOf<T> = T extends Handler<infer I, any> ? I : never;
type OutputOf<T> = T extends Handler<any, infer O> ? O : never;
export type QueryFunction<I, O> = ((input: I) => Promise<O>) & { readonly queryId: string };
export type ClientApi<A extends Contract> = {
  query: { [K in keyof A["query"]]: QueryFunction<InputOf<A["query"][K]>, OutputOf<A["query"][K]>> };
  mutation: { [K in keyof A["mutation"]]: (input: InputOf<A["mutation"][K]>) => Promise<OutputOf<A["mutation"][K]>> };
};

export function createReactiveDataClient<A extends Contract>(): { api: ClientApi<A>; runtime: LiveQueryRuntime } {
  const rpc = Electroview.defineRPC<ReactiveRpcSchema>({ maxRequestTime: 10_000, handlers: { requests: {}, messages: {} } });
  new Electroview({ rpc });
  const feed = new ElectrobunFeed(rpc as unknown as ReactiveRpcClient);
  const query = new Proxy(Object.create(null), { get: (_t, name: string) => Object.assign((input: unknown) => feed.invoke("query", name, input), { queryId: `query.${name}` }) });
  const mutation = new Proxy(Object.create(null), { get: (_t, name: string) => (input: unknown) => feed.invoke("mutation", name, input) });
  return { api: { query, mutation } as ClientApi<A>, runtime: new LiveQueryRuntime(feed) };
}

export { LiveQueryRuntime, type LiveQuerySnapshot } from "./core.js";
