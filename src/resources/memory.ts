/** Memory resource: recall, remember, forget, and agent-friendly aliases. */

import type { Transport } from "../transport.js";
import type {
  Bank,
  InvestigateOptions,
  ListRecentOptions,
  RecallOptions,
  RecallResult,
  RememberOptions,
  RememberResult,
} from "../types.js";
import * as ops from "./ops.js";

export class MemoryResource {
  constructor(
    private readonly transport: Transport,
    private readonly defaultNamespace?: string,
  ) {}

  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult> {
    const { data, metering } = await this.transport.request<unknown>(
      ops.buildRecall(query, {
        namespace: options.namespace ?? this.defaultNamespace,
        topK: options.topK,
        filters: options.filters,
        verbose: options.verbose,
      }),
    );
    return ops.parseRecall(data, metering);
  }

  /** Agent-style recall with a sensible default `topK` of 5. */
  async investigate(query: string, options: InvestigateOptions = {}): Promise<RecallResult> {
    return this.recall(query, {
      namespace: options.namespaceHint,
      topK: options.topK ?? 5,
    });
  }

  async remember(text: string, options: RememberOptions = {}): Promise<RememberResult> {
    const { data } = await this.transport.request<unknown>(
      ops.buildRemember(text, {
        namespace: options.namespace ?? this.defaultNamespace,
        source: options.source,
        tags: options.tags,
      }),
    );
    return ops.parseRemember(data);
  }

  /** Alias for `remember` matching the `auto_memorize` tool. */
  async memorize(content: string, options: RememberOptions = {}): Promise<RememberResult> {
    return this.remember(content, options);
  }

  async forget(memoryId: string, options: { namespace?: string } = {}): Promise<void> {
    await this.transport.request<unknown>(
      ops.buildForget(memoryId, options.namespace ?? this.defaultNamespace),
    );
  }

  async listBanks(): Promise<Bank[]> {
    const { data } = await this.transport.request<unknown>(ops.buildListBanks());
    return ops.parseBanks(data);
  }

  async listRecent(options: ListRecentOptions = {}): Promise<unknown[]> {
    const { data } = await this.transport.request<unknown>(
      ops.buildListRecent({ namespace: options.namespace ?? this.defaultNamespace, n: options.n }),
    );
    if (Array.isArray(data)) return data;
    const record = data as Record<string, unknown>;
    return Array.isArray(record?.memories) ? (record.memories as unknown[]) : [];
  }
}

// Re-export to keep the public option type importable from this module too.
export type { RecallResult, RememberResult };
