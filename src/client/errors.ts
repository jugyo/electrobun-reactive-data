import type { ErrorCode } from "../protocol.js";

export type ReactiveDataErrorCode = ErrorCode | "TRANSPORT" | "STOPPED";

export class ReactiveDataError extends Error {
  constructor(
    readonly code: ReactiveDataErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReactiveDataError";
  }
}

export function transportError(cause: unknown): ReactiveDataError {
  return cause instanceof ReactiveDataError
    ? cause
    : new ReactiveDataError(
        "TRANSPORT",
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
}
