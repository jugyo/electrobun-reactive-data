import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import {
  LiveQueryRuntime,
  type LiveQuerySnapshot,
  type QueryFunction,
} from "../client/index.js";
const Context = createContext<LiveQueryRuntime | null>(null);
export function ReactiveDataProvider({
  runtime,
  children,
}: PropsWithChildren<{ runtime: LiveQueryRuntime }>) {
  useEffect(() => runtime.attachRendererRoot(), [runtime]);
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useLiveQuery<P, R>(
  query: QueryFunction<P, R>,
  params: P,
): LiveQuerySnapshot<R> & { refresh(): Promise<void> } {
  const runtime = useContext(Context);
  if (!runtime)
    throw new Error("useLiveQuery must be used inside ReactiveDataProvider");
  const key = JSON.stringify(params);
  const instance = useMemo(
    () => runtime.getInstance(query.queryId, query, params),
    [runtime, query, key],
  );
  const snapshot = useSyncExternalStore(
    instance.subscribe,
    instance.getSnapshot,
    instance.getSnapshot,
  );
  return useMemo(
    () => ({ ...snapshot, refresh: () => instance.refresh() }),
    [snapshot, instance],
  );
}
