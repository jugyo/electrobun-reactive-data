export const PROTOCOL_VERSION = 1;
export {
  MAX_WIRE_BYTES,
  MAX_WIRE_DEPTH,
  assertWireValue,
  prepareWireValue,
} from "./wire.js";
export const MAX_QUERIES = 256;

export type OperationKind = "query" | "mutation";
export type ErrorCode =
  | "INVALID_INPUT"
  | "UNKNOWN_OPERATION"
  | "STALE_SESSION"
  | "STOPPING"
  | "INTERNAL";
export type WireError = { code: ErrorCode; message: string };
export type Envelope<T = unknown> =
  { ok: true; value: T } | { ok: false; error: WireError };
export type ConnectParams = { protocolVersion: number };
export type InvokeParams = {
  session: string;
  kind: OperationKind;
  name: string;
  input: unknown;
};
export type SetQueriesParams = {
  session: string;
  revision: number;
  queries: string[];
};
export type DisconnectParams = { session: string };
export type ChangedMessage = { session: string; queries: string[] };

export type ReactiveRpcSchema = {
  bun: {
    requests: {
      connect: {
        params: ConnectParams;
        response: Envelope<{ session: string }>;
      };
      invoke: { params: InvokeParams; response: Envelope };
      setQueries: {
        params: SetQueriesParams;
        response: Envelope<{ revision: number; queries: string[] }>;
      };
      disconnect: { params: DisconnectParams; response: Envelope<null> };
    };
    messages: {};
  };
  webview: { requests: {}; messages: { changed: ChangedMessage } };
};
