/**
 * Pure request builders and response parsers, shared so request shaping lives
 * in one place. Each builder returns the method, path and JSON body; each
 * parser normalizes the runtime's compact wire shape into the SDK's types.
 */

import type { RequestOptions } from "../transport.js";
import type {
  Bank,
  Chunk,
  ContextPack,
  MeteringMeta,
  RecallResult,
  RememberResult,
} from "../types.js";

type Json = Record<string, unknown>;

function compact(payload: Json): Json {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
}

export function buildRecall(
  query: string,
  opts: { namespace?: string; topK?: number; filters?: Json; verbose?: boolean },
): RequestOptions {
  return {
    method: "POST",
    path: "/v1/recall",
    body: compact({
      query,
      namespace: opts.namespace,
      top_k: opts.topK,
      filters: opts.filters,
      verbose: opts.verbose,
    }),
  };
}

export function parseRecall(data: unknown, metering: MeteringMeta): RecallResult {
  const record = (data && typeof data === "object" ? data : {}) as Json;
  const rawChunks = Array.isArray(record.chunks)
    ? record.chunks
    : Array.isArray(data)
      ? (data as unknown[])
      : [];
  const chunks: Chunk[] = rawChunks.map((c) => {
    const item = c as Json;
    return {
      id: String(item.i ?? item.id ?? ""),
      score: typeof item.s === "number" ? item.s : (item.score as number | undefined),
      text: String(item.t ?? item.text ?? ""),
      tags: (item.g ?? item.tags) as string | undefined,
    };
  });
  const top = chunks[0]?.score;
  return {
    chunks,
    namespace: record.namespace as string | undefined,
    metering,
    weak: top !== undefined && top < 0.85,
  };
}

export function buildRemember(
  text: string,
  opts: { namespace?: string; source?: string; tags?: string },
): RequestOptions {
  return {
    method: "POST",
    path: "/v1/remember",
    body: compact({ text, namespace: opts.namespace, source: opts.source, tags: opts.tags }),
  };
}

export function parseRemember(data: unknown): RememberResult {
  const record = (data && typeof data === "object" ? data : {}) as Json;
  return {
    memoryId: (record.id ?? record.memory_id) as string | undefined,
    namespace: record.namespace as string | undefined,
  };
}

export function buildForget(memoryId: string, namespace?: string): RequestOptions {
  return {
    method: "POST",
    path: "/v1/forget",
    body: compact({ memory_id: memoryId, namespace }),
  };
}

export function buildListBanks(): RequestOptions {
  return { method: "GET", path: "/v1/banks" };
}

export function parseBanks(data: unknown): Bank[] {
  const record = data as Json;
  const items = Array.isArray(data)
    ? data
    : Array.isArray(record?.banks)
      ? (record.banks as unknown[])
      : [];
  return items.map((b) => {
    const item = b as Json;
    return {
      namespace: String(item.namespace ?? ""),
      count: item.count as number | undefined,
    };
  });
}

export function buildListRecent(opts: { namespace?: string; n?: number }): RequestOptions {
  const params = new URLSearchParams();
  if (opts.namespace) params.set("namespace", opts.namespace);
  if (opts.n !== undefined) params.set("n", String(opts.n));
  const query = params.toString();
  return { method: "GET", path: `/v1/recent${query ? `?${query}` : ""}` };
}

export function buildContextPack(
  query: string,
  opts: { namespace: string; maxTokens?: number; repoRoot?: string },
): RequestOptions {
  return {
    method: "POST",
    path: "/v1/context-pack",
    body: compact({
      query,
      namespace: opts.namespace,
      max_tokens: opts.maxTokens,
      repo_root: opts.repoRoot,
    }),
  };
}

export function parseContextPack(data: unknown, metering: MeteringMeta): ContextPack {
  const record = (data && typeof data === "object" ? data : {}) as Json;
  return {
    pack: String(record.pack ?? record.context ?? record.text ?? data ?? ""),
    tokensEstimated: record.tokens_estimated as number | undefined,
    namespace: record.namespace as string | undefined,
    metering,
  };
}

export function buildIngestRepo(
  namespace: string,
  opts: { repoRoot: string; ref?: string },
): RequestOptions {
  return {
    method: "POST",
    path: `/v1/repos/${encodeURIComponent(namespace)}/ingest`,
    body: compact({ repo_root: opts.repoRoot, ref: opts.ref }),
  };
}

export function buildExecute(operations: Json[]): RequestOptions {
  return { method: "POST", path: "/v1/execute", body: { operations } };
}

export function buildHealth(): RequestOptions {
  return { method: "GET", path: "/v1/health" };
}
