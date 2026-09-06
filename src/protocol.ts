export const PROTOCOL_VERSION = 1;
export const MAX_WIRE_BYTES = 256 * 1024;
export const MAX_QUERIES = 256;

export type OperationKind = "query" | "mutation";
export type ErrorCode = "INVALID_INPUT" | "UNKNOWN_OPERATION" | "STALE_SESSION" | "STOPPING" | "INTERNAL";
export type WireError = { code: ErrorCode; message: string };
export type Envelope<T = unknown> = { ok: true; value: T } | { ok: false; error: WireError };
export type ConnectParams = { protocolVersion: number };
export type InvokeParams = { session: string; kind: OperationKind; name: string; input: unknown };
export type SetQueriesParams = { session: string; revision: number; queries: string[] };
export type DisconnectParams = { session: string };
export type ChangedMessage = { session: string; queries: string[] };

export type ReactiveRpcSchema = {
  bun: {
    requests: {
      connect: { params: ConnectParams; response: Envelope<{ session: string }> };
      invoke: { params: InvokeParams; response: Envelope };
      setQueries: { params: SetQueriesParams; response: Envelope<{ revision: number; queries: string[] }> };
      disconnect: { params: DisconnectParams; response: Envelope<null> };
    };
    messages: {};
  };
  webview: { requests: {}; messages: { changed: ChangedMessage } };
};

export function assertWireValue(value: unknown): void {
  const encoded = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint" || typeof item === "function" || typeof item === "symbol" || item === undefined) {
      throw new Error("Unsupported wire value");
    }
    return item;
  });
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_WIRE_BYTES) {
    throw new Error("Wire value exceeds the supported payload size");
  }
}
