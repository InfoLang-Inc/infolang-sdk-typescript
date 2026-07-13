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

function hitToChunk(hit: Json): Json {
  return {
    i: hit.id ?? hit.i,
    t: hit.text ?? hit.t ?? "",
    g: hit.tags ?? hit.g,
    s: hit.similarity ?? hit.score ?? hit.s,
  };
}

export function parseRecall(data: unknown, metering: MeteringMeta): RecallResult {
  const record = (data && typeof data === "object" ? data : {}) as Json;
  const rawChunks = Array.isArray(record.chunks)
    ? record.chunks
    : Array.isArray(record.hits)
      ? (record.hits as Json[]).map((hit) => hitToChunk(hit))
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
  // Runtime forget is DELETE /v1/memories/{id}; namespace is auth-scoped.
  void namespace;
  return {
    method: "DELETE",
    path: `/v1/memories/${encodeURIComponent(memoryId)}`,
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
    const count =
      typeof item.count === "number"
        ? item.count
        : typeof item.total_memories === "number"
          ? item.total_memories
          : undefined;
    return {
      namespace: String(item.namespace ?? ""),
      count,
    };
  });
}

export function buildListRecent(opts: { namespace?: string; n?: number }): RequestOptions {
  const params = new URLSearchParams();
  if (opts.namespace) params.set("namespace", opts.namespace);
  if (opts.n !== undefined) params.set("limit", String(opts.n));
  const query = params.toString();
  return { method: "GET", path: `/v1/memories${query ? `?${query}` : ""}` };
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

export function filterHitsByTags(
  chunks: Chunk[],
  tagFilter: string[] | undefined,
  topK: number | undefined,
): Chunk[] {
  let ordered = chunks;
  if (tagFilter && tagFilter.length > 0) {
    const wanted = new Set(
      tagFilter.map((t) => t.trim().toLowerCase()).filter(Boolean),
    );
    const matches = (chunk: Chunk): boolean => {
      if (!chunk.tags) return false;
      const have = new Set(
        chunk.tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
      );
      for (const t of wanted) {
        if (have.has(t)) return true;
      }
      return false;
    };
    ordered = [...chunks.filter(matches), ...chunks.filter((c) => !matches(c))];
  }
  return topK !== undefined ? ordered.slice(0, topK) : ordered;
}

export function buildRememberBatch(
  items: Array<{ text: string; source?: string; tags?: string | string[] }>,
  opts: { namespace?: string; source?: string },
): RequestOptions {
  const batchItems = items.map((item) =>
    compact({
      text: item.text,
      source: item.source ?? opts.source,
      tags: item.tags,
    }),
  );
  return buildExecute([
    {
      op: "remember_batch",
      args: compact({
        items: batchItems,
        namespace: opts.namespace,
        source: opts.source,
      }),
    },
  ]);
}

export function parseExecuteRememberBatch(data: unknown): RememberResult[] {
  const record = data as Json;
  const results = Array.isArray(record?.results) ? (record.results as Json[]) : [];
  const out: RememberResult[] = [];
  for (const result of results) {
    const payload = result?.payload as Json | undefined;
    const inner = Array.isArray(payload?.results) ? (payload.results as unknown[]) : null;
    if (inner) {
      for (const r of inner) {
        out.push(parseRemember(r));
      }
    } else {
      out.push(parseRemember(payload ?? {}));
    }
  }
  return out;
}

export function normalizeRememberItems(
  items: Array<string | { text: string; tags?: string | string[]; source?: string }>,
  defaultSource?: string,
): Array<{ text: string; source?: string; tags?: string | string[] }> {
  return items.map((item) => {
    if (typeof item === "string") {
      return { text: item, source: defaultSource };
    }
    if (item && typeof item === "object" && typeof item.text === "string") {
      return item;
    }
    throw new TypeError("rememberBatch items must be string or { text } object");
  });
}
