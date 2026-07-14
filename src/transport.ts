/**
 * fetch-native HTTP transport.
 *
 * Works on Node 18+, Bun, Deno, Cloudflare Workers and browsers without
 * polyfills. Adds the resilience defaults expected of a modern SDK: targeted
 * retries (429 + 5xx) with exponential backoff and full jitter, an explicit
 * timeout budget via AbortController, and typed error mapping.
 */

import type { AuthProvider } from "./auth.js";
import { errorFromResponse, InfoLangConnectionError } from "./errors.js";
import type { MeteringMeta } from "./types.js";

export type FetchLike = typeof fetch;

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface TransportOptions {
  baseUrl: string;
  auth: AuthProvider;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  userAgent: string;
  /** When set, sent as X-InfoLang-Workspace-Id on every request. */
  workspaceId?: string;
}

export interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface TransportResult<T> {
  data: T;
  metering: MeteringMeta;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseMetering(headers: Headers): MeteringMeta {
  const num = (name: string): number | undefined => {
    const raw = headers.get(name);
    if (raw == null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    tokensSaved: num("x-infolang-tokens-saved"),
    chunksUsed: num("x-infolang-chunks-used"),
    repoCoverage: num("x-infolang-repo-coverage"),
    requestId: headers.get("x-request-id") ?? undefined,
  };
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export class Transport {
  private readonly baseUrl: string;
  private readonly auth: AuthProvider;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  private readonly userAgent: string;
  private readonly workspaceId?: string;

  constructor(options: TransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.auth = options.auth;
    // Workers/workerd (and some other runtimes) brand-check `fetch`'s
    // receiver; a detached reference throws "Illegal invocation" unless
    // it's rebound to globalThis.
    this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.backoffCapMs = options.backoffCapMs ?? 8_000;
    this.userAgent = options.userAgent;
    this.workspaceId = options.workspaceId;
    if (!this.fetchImpl) {
      throw new InfoLangConnectionError(
        "global fetch is unavailable; pass a fetch implementation via the client options",
      );
    }
  }

  private delay(attempt: number, retryAfterSec?: number): number {
    if (retryAfterSec != null) return retryAfterSec * 1000;
    const window = Math.min(this.backoffCapMs, this.backoffBaseMs * 2 ** attempt);
    return Math.random() * window;
  }

  async request<T>(options: RequestOptions): Promise<TransportResult<T>> {
    const url = `${this.baseUrl}${options.path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers: Record<string, string> = {
        "User-Agent": this.userAgent,
        Accept: "application/json",
        ...(await this.auth.headers()),
        ...options.headers,
      };
      if (this.workspaceId) {
        headers["X-InfoLang-Workspace-Id"] = this.workspaceId;
      }
      if (options.body !== undefined) headers["Content-Type"] = "application/json";

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: options.method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        lastError = err;
        clearTimeout(timer);
        if (attempt >= this.maxRetries) {
          throw new InfoLangConnectionError(
            err instanceof Error ? err.message : "request failed",
          );
        }
        await sleep(this.delay(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (RETRY_STATUSES.has(response.status) && attempt < this.maxRetries) {
        await sleep(this.delay(attempt, retryAfter(response.headers)));
        continue;
      }
      return this.finish<T>(response);
    }

    throw new InfoLangConnectionError(
      lastError instanceof Error ? lastError.message : "request failed after retries",
    );
  }

  private async finish<T>(response: Response): Promise<TransportResult<T>> {
    const metering = parseMetering(response.headers);
    const text = await response.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (response.ok) return { data: data as T, metering };

    throw errorFromResponse({
      status: response.status,
      body: data,
      requestId: metering.requestId,
      retryAfter: retryAfter(response.headers),
    });
  }
}
