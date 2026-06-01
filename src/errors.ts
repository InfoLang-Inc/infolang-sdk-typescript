/**
 * Typed error hierarchy for the InfoLang SDK.
 *
 * Catch these instead of inspecting raw responses. Every API error carries the
 * originating `requestId` (from the `x-request-id` header) when available.
 */

export class InfoLangError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Client misconfiguration (missing credentials, bad base URL). */
export class InfoLangConfigError extends InfoLangError {}

/** The runtime could not be reached, or the request timed out. */
export class InfoLangConnectionError extends InfoLangError {}

export interface APIErrorOptions {
  status: number;
  body?: unknown;
  requestId?: string;
  retryAfter?: number;
}

/** A non-2xx response from the runtime. */
export class InfoLangAPIError extends InfoLangError {
  readonly status: number;
  readonly body: unknown;
  readonly requestId?: string;

  constructor(message: string, options: APIErrorOptions) {
    const suffix = options.requestId ? ` (request_id=${options.requestId})` : "";
    super(`${message}${suffix}`);
    this.status = options.status;
    this.body = options.body;
    this.requestId = options.requestId;
  }
}

/** 401/403 — credential missing, invalid, or lacking permission. */
export class AuthenticationError extends InfoLangAPIError {}

/** 404 — namespace, bank, or memory id does not exist. */
export class NotFoundError extends InfoLangAPIError {}

/** 400/422 — the request payload was rejected. */
export class ValidationError extends InfoLangAPIError {}

/** 429 — quota exceeded. `retryAfter` is seconds when the server sets it. */
export class RateLimitError extends InfoLangAPIError {
  readonly retryAfter?: number;

  constructor(message: string, options: APIErrorOptions) {
    super(message, options);
    this.retryAfter = options.retryAfter;
  }
}

/** 5xx — the runtime failed to process the request. */
export class ServerError extends InfoLangAPIError {}

function messageFromBody(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
  }
  if (typeof body === "string" && body) return body;
  return undefined;
}

export function errorFromResponse(options: APIErrorOptions): InfoLangAPIError {
  const message =
    messageFromBody(options.body) ?? `InfoLang request failed with status ${options.status}`;
  switch (true) {
    case options.status === 401 || options.status === 403:
      return new AuthenticationError(message, options);
    case options.status === 404:
      return new NotFoundError(message, options);
    case options.status === 400 || options.status === 422:
      return new ValidationError(message, options);
    case options.status === 429:
      return new RateLimitError(message, options);
    case options.status >= 500:
      return new ServerError(message, options);
    default:
      return new InfoLangAPIError(message, options);
  }
}
