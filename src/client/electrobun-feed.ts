import {
  PROTOCOL_VERSION,
  type ChangedMessage,
  type Envelope,
} from "../protocol.js";
import type { ChangeFeed, ChangeFeedHandlers } from "./core.js";
import { ReactiveDataError, transportError } from "./errors.js";
import { prepareWireValue } from "../wire.js";

export interface ReactiveRpcClient {
  request: {
    connect(params: {
      protocolVersion: number;
    }): Promise<Envelope<{ session: string }>>;
    invoke(params: {
      session: string;
      kind: "query" | "mutation";
      name: string;
      input: unknown;
    }): Promise<Envelope>;
    setQueries(params: {
      session: string;
      revision: number;
      queries: string[];
    }): Promise<Envelope<{ revision: number; queries: string[] }>>;
    disconnect(params: { session: string }): Promise<Envelope<null>>;
  };
  addMessageListener(
    name: "changed",
    listener: (message: ChangedMessage) => void,
  ): void;
  removeMessageListener(
    name: "changed",
    listener: (message: ChangedMessage) => void,
  ): void;
}

export class ElectrobunFeed implements ChangeFeed {
  private desired: string[] = [];
  private desiredVersion = 0;
  private submittedVersion = -1;
  private handlers?: ChangeFeedHandlers;
  private session?: string;
  private revision = 0;
  private generation = 0;
  private connectPromise?: Promise<string>;
  private submitPromise?: Promise<void>;
  private started = false;
  private stopped = false;

  constructor(private readonly rpc: ReactiveRpcClient) {}

  setQueries(ids: readonly string[]): void {
    if (
      ids.length === this.desired.length &&
      ids.every((id, index) => id === this.desired[index])
    )
      return;
    this.desired = [...ids];
    this.desiredVersion += 1;
    if (this.session) this.startSubmit();
  }

  start(handlers: ChangeFeedHandlers): void {
    if (this.stopped) throw new Error("A stopped client cannot be restarted");
    if (this.started) return;
    this.started = true;
    this.handlers = handlers;
    this.rpc.addMessageListener("changed", this.onChanged);
    void this.ensureConnected().catch((error) => this.report(error));
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.started = false;
    const session = this.session;
    this.session = undefined;
    this.connectPromise = undefined;
    this.submitPromise = undefined;
    this.generation += 1;
    this.rpc.removeMessageListener("changed", this.onChanged);
    this.handlers = undefined;
    if (session) void this.rpc.request.disconnect({ session }).catch(() => {});
  }

  async invoke(
    kind: "query" | "mutation",
    name: string,
    input: unknown,
  ): Promise<unknown> {
    if (this.stopped)
      throw new ReactiveDataError("STOPPED", "Reactive data client is stopped");
    try {
      input = prepareWireValue(input);
    } catch (cause) {
      throw new ReactiveDataError(
        "INVALID_INPUT",
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
    }
    const alreadyConnected = this.session !== undefined;
    const session = await this.ensureConnected().catch((error) => {
      throw transportError(error);
    });
    // An explicit query/refresh can retry a failed subscription; failures never spin.
    if (
      alreadyConnected &&
      kind === "query" &&
      this.submittedVersion !== this.desiredVersion
    )
      this.startSubmit();
    let response: Envelope;
    try {
      response = await this.rpc.request.invoke({ session, kind, name, input });
    } catch (error) {
      if (kind === "mutation") throw transportError(error);
      return this.retryQuery(name, input, session, error);
    }
    if (
      !response.ok &&
      response.error.code === "STALE_SESSION" &&
      kind === "query"
    ) {
      return this.retryQuery(
        name,
        input,
        session,
        new Error(response.error.message),
      );
    }
    if (!response.ok)
      throw new ReactiveDataError(response.error.code, response.error.message);
    return response.value;
  }

  private readonly onChanged = (message: ChangedMessage): void => {
    if (!this.stopped && message.session === this.session) {
      this.handlers?.onNotifications({ queries: message.queries });
    }
  };

  private ensureConnected(): Promise<string> {
    if (this.stopped)
      return Promise.reject(
        new ReactiveDataError("STOPPED", "Reactive data client is stopped"),
      );
    if (this.session) return Promise.resolve(this.session);
    if (this.connectPromise) return this.connectPromise;
    const generation = this.generation;
    const promise = this.rpc.request
      .connect({ protocolVersion: PROTOCOL_VERSION })
      .then((response) => {
        if (this.stopped || generation !== this.generation)
          throw new ReactiveDataError(
            "STOPPED",
            "Obsolete reactive data connection",
          );
        if (!response.ok)
          throw new ReactiveDataError(
            response.error.code,
            response.error.message,
          );
        this.session = response.value.session;
        this.revision = 0;
        this.submittedVersion = -1;
        this.startSubmit();
        return response.value.session;
      })
      .finally(() => {
        if (this.connectPromise === promise) this.connectPromise = undefined;
      });
    this.connectPromise = promise;
    return promise;
  }

  private startSubmit(): void {
    if (this.submitPromise || !this.session || this.stopped) return;
    const generation = this.generation;
    const session = this.session;
    let failed = false;
    const run = async (): Promise<void> => {
      while (
        !this.stopped &&
        generation === this.generation &&
        session === this.session
      ) {
        const desiredVersion = this.desiredVersion;
        const queries = [...this.desired];
        const revision = ++this.revision;
        const response = await this.rpc.request.setQueries({
          session,
          revision,
          queries,
        });
        if (
          this.stopped ||
          generation !== this.generation ||
          session !== this.session
        )
          return;
        if (!response.ok) {
          if (response.error.code === "STALE_SESSION")
            this.invalidateSession(session);
          throw new ReactiveDataError(
            response.error.code,
            response.error.message,
          );
        }
        if (response.value.revision === revision)
          this.handlers?.onSubscribed(response.value.queries);
        this.submittedVersion = desiredVersion;
        if (desiredVersion === this.desiredVersion) return;
      }
    };
    const promise = run()
      .catch((error) => {
        failed = true;
        if (generation === this.generation || !this.session) this.report(error);
      })
      .finally(() => {
        if (this.submitPromise === promise) {
          this.submitPromise = undefined;
          if (
            !failed &&
            !this.stopped &&
            this.session === session &&
            generation === this.generation &&
            this.submittedVersion !== this.desiredVersion
          ) {
            // A desired-set change that landed while the promise settled gets another serialized pass.
            this.startSubmit();
          }
        }
      });
    this.submitPromise = promise;
  }

  private async retryQuery(
    name: string,
    input: unknown,
    failedSession: string,
    cause: unknown,
  ): Promise<unknown> {
    if (this.stopped) throw cause;
    this.invalidateSession(failedSession);
    const session = await this.ensureConnected();
    const response = await this.rpc.request
      .invoke({
        session,
        kind: "query",
        name,
        input,
      })
      .catch((error) => {
        throw transportError(error);
      });
    if (!response.ok)
      throw new ReactiveDataError(response.error.code, response.error.message);
    return response.value;
  }

  private invalidateSession(session: string): void {
    if (this.session !== session) return;
    this.session = undefined;
    this.submitPromise = undefined;
    this.generation += 1;
  }

  private report(error: unknown): void {
    if (!this.stopped) this.handlers?.onError(transportError(error));
  }
}
