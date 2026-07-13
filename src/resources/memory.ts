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

  /** Recall with tag-inclusion ordering over a candidate pool (client-side). */
  async recallHybrid(
    query: string,
    options: {
      namespace?: string;
      topK?: number;
      tagFilter?: string[];
      candidatePool?: number;
      useHybrid?: boolean;
    } = {},
  ): Promise<RecallResult> {
    void options.useHybrid;
    const ns = options.namespace ?? this.defaultNamespace;
    const topK = options.topK ?? 10;
    const pool = Math.max(options.candidatePool ?? 0, topK) || topK;
    const result = await this.recall(query, { namespace: ns, topK: pool });
    result.chunks = ops.filterHitsByTags(result.chunks, options.tagFilter, topK);
    return result;
  }

  /** Store many memories via POST /v1/execute remember_batch. */
  async rememberBatch(
    items: Array<string | { text: string; tags?: string | string[]; source?: string }>,
    options: { namespace?: string; source?: string } = {},
  ): Promise<RememberResult[]> {
    if (!items.length) return [];
    const records = ops.normalizeRememberItems(items, options.source);
    const { data } = await this.transport.request<unknown>(
      ops.buildRememberBatch(records, {
        namespace: options.namespace ?? this.defaultNamespace,
        source: options.source,
      }),
    );
    return ops.parseExecuteRememberBatch(data);
  }

  /** Best-effort bulk clear (list + forget loop). */
  async resetNamespace(namespace?: string, options: { batch?: number } = {}): Promise<number> {
    const ns = namespace ?? this.defaultNamespace;
    const batch = options.batch ?? 500;
    let deleted = 0;
    while (true) {
      const recent = await this.listRecent({ namespace: ns, n: batch });
      const ids = recent
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const row = r as Record<string, unknown>;
          for (const key of ["id", "memory_id", "i"] as const) {
            const v = row[key];
            if (typeof v === "string" && v) return v;
          }
          return null;
        })
        .filter((id): id is string => Boolean(id));
      if (!ids.length) break;
      for (const id of ids) {
        await this.forget(id, { namespace: ns });
        deleted += 1;
      }
      if (ids.length < batch) break;
    }
    return deleted;
  }
}

// Re-export to keep the public option type importable from this module too.
export type { RecallResult, RememberResult };
