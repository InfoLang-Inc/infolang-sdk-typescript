/**
 * The InfoLang client: one-line construction over the il-runtime REST API.
 *
 * Exposes grouped resources (`client.memory`, `client.context`,
 * `client.health`) plus the common operations as top-level aliases so the
 * first call is a one-liner.
 */

import {
  ApiKeyAuth,
  type AuthProvider,
  DevKeyAuth,
  SessionFileAuth,
} from "./auth.js";
import { InfoLangConfigError } from "./errors.js";
import { ContextResource } from "./resources/context.js";
import { HealthResource } from "./resources/health.js";
import { MemoryResource } from "./resources/memory.js";
import { type FetchLike, Transport } from "./transport.js";
import type {
  Bank,
  ContextPack,
  ContextPackOptions,
  InvestigateOptions,
  ListRecentOptions,
  RecallOptions,
  RecallResult,
  RememberOptions,
  RememberResult,
} from "./types.js";
import { version } from "./version.js";

export const CLOUD_BASE_URL = "https://api.infolang.ai";
export const DIRECT_BASE_URL = "http://127.0.0.1:8766";

export interface InfoLangOptions {
  /** Managed-cloud API key (`il_live_...`). Defaults to the cloud base URL. */
  apiKey?: string;
  /** Self-hosted dev key in `key:namespace` form. Defaults to the direct base URL. */
  devKey?: string;
  /** An explicit auth provider (e.g. `new SessionFileAuth()`). */
  auth?: AuthProvider;
  baseUrl?: string;
  namespace?: string;
  /**
   * Account workspace to target. Sent as `X-InfoLang-Workspace-Id`.
   * Must be in the API key's allowlist (or a membership for JWT auth).
   * Also reads `INFOLANG_WORKSPACE` / `INFOLANG_WORKSPACE_ID`.
   */
  workspace?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Custom fetch (for Workers, mocks, or a TLS-configured agent). */
  fetch?: FetchLike;
}

function resolveAuth(options: InfoLangOptions): AuthProvider {
  if (options.auth) return options.auth;
  if (options.apiKey) return new ApiKeyAuth(options.apiKey);
  if (options.devKey) return new DevKeyAuth(options.devKey);
  const envKey = globalThis.process?.env?.INFOLANG_API_KEY;
  if (envKey) return new ApiKeyAuth(envKey);
  const envDev = globalThis.process?.env?.INFOLANG_DEV_KEY;
  if (envDev) return new DevKeyAuth(envDev);
  throw new InfoLangConfigError(
    "No credentials. Pass apiKey, devKey, or auth, set INFOLANG_API_KEY, " +
      "or use InfoLang.fromSessionFile().",
  );
}

function resolveBaseUrl(options: InfoLangOptions, auth: AuthProvider): string {
  if (options.baseUrl) return options.baseUrl;
  const envUrl = globalThis.process?.env?.INFOLANG_BASE_URL;
  if (envUrl) return envUrl;
  return auth instanceof DevKeyAuth ? DIRECT_BASE_URL : CLOUD_BASE_URL;
}

function resolveNamespace(options: InfoLangOptions, auth: AuthProvider): string | undefined {
  if (options.namespace) return options.namespace;
  if (auth instanceof DevKeyAuth) return auth.namespace;
  return globalThis.process?.env?.INFOLANG_NAMESPACE;
}

function resolveWorkspace(options: InfoLangOptions): string | undefined {
  if (options.workspace) return options.workspace;
  return (
    globalThis.process?.env?.INFOLANG_WORKSPACE ??
    globalThis.process?.env?.INFOLANG_WORKSPACE_ID
  );
}

export class InfoLang {
  readonly namespace?: string;
  readonly workspace?: string;
  readonly baseUrl: string;
  readonly memory: MemoryResource;
  readonly context: ContextResource;
  readonly health: HealthResource;

  constructor(options: InfoLangOptions = {}) {
    const auth = resolveAuth(options);
    this.baseUrl = resolveBaseUrl(options, auth);
    this.namespace = resolveNamespace(options, auth);
    this.workspace = resolveWorkspace(options);
    const transport = new Transport({
      baseUrl: this.baseUrl,
      auth,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      userAgent: `infolang-typescript/${version}`,
      workspaceId: this.workspace,
    });
    this.memory = new MemoryResource(transport, this.namespace);
    this.context = new ContextResource(transport, this.namespace);
    this.health = new HealthResource(transport);
  }

  // --- constructors ---------------------------------------------------

  static fromApiKey(apiKey: string, options: Omit<InfoLangOptions, "apiKey"> = {}): InfoLang {
    return new InfoLang({ ...options, apiKey });
  }

  static fromDevKey(devKey: string, options: Omit<InfoLangOptions, "devKey"> = {}): InfoLang {
    return new InfoLang({ ...options, devKey });
  }

  static fromSessionFile(path?: string, options: Omit<InfoLangOptions, "auth"> = {}): InfoLang {
    return new InfoLang({ ...options, auth: new SessionFileAuth(path) });
  }

  // --- top-level aliases ----------------------------------------------

  recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    return this.memory.recall(query, options);
  }

  investigate(query: string, options?: InvestigateOptions): Promise<RecallResult> {
    return this.memory.investigate(query, options);
  }

  remember(text: string, options?: RememberOptions): Promise<RememberResult> {
    return this.memory.remember(text, options);
  }

  memorize(content: string, options?: RememberOptions): Promise<RememberResult> {
    return this.memory.memorize(content, options);
  }

  forget(memoryId: string, options?: { namespace?: string }): Promise<void> {
    return this.memory.forget(memoryId, options);
  }

  listBanks(): Promise<Bank[]> {
    return this.memory.listBanks();
  }

  listRecent(options?: ListRecentOptions): Promise<unknown[]> {
    return this.memory.listRecent(options);
  }

  recallHybrid(
    query: string,
    options?: {
      namespace?: string;
      topK?: number;
      tagFilter?: string[];
      candidatePool?: number;
      useHybrid?: boolean;
    },
  ): Promise<RecallResult> {
    return this.memory.recallHybrid(query, options);
  }

  rememberBatch(
    items: Array<string | { text: string; tags?: string | string[]; source?: string }>,
    options?: { namespace?: string; source?: string },
  ): Promise<RememberResult[]> {
    return this.memory.rememberBatch(items, options);
  }

  resetNamespace(namespace?: string, options?: { batch?: number }): Promise<number> {
    return this.memory.resetNamespace(namespace, options);
  }

  contextPack(query: string, options?: ContextPackOptions): Promise<ContextPack> {
    return this.context.contextPack(query, options);
  }

  ingestRepo(
    namespace: string,
    options: { repoRoot: string; ref?: string },
  ): Promise<Record<string, unknown>> {
    return this.context.ingestRepo(namespace, options);
  }

  execute(operations: Record<string, unknown>[]): Promise<Record<string, unknown>> {
    return this.context.execute(operations);
  }
}
