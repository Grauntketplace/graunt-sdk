/**
 * The Graunt API answered with an error: a non-2xx status, usually carrying
 * Graunt's error envelope `{ ok: false, error: { code, message, details? } }`.
 */
export class GrauntError extends Error {
  /** HTTP status code of the response. */
  readonly status: number;
  /**
   * Stable machine-readable code, for example `NOT_FOUND`, `RATE_LIMITED` or
   * `ACCESS_PASS_LIBRARY_EMPTY`. When the body is not Graunt's envelope this is
   * `HTTP_<status>`.
   */
  readonly code: string;
  /** Extra fields the API attached to the error, when it sent any. */
  readonly details: Readonly<Record<string, unknown>> | undefined;
  /** Seconds to wait before retrying, from a numeric `Retry-After` header. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = "GrauntError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * The request produced no HTTP response: a DNS, connection or TLS failure, or
 * the per-request timeout elapsed. The underlying error is on `cause`.
 */
export class GrauntConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GrauntConnectionError";
  }
}
