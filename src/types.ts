/**
 * Request and response types mirroring the il-runtime REST contract
 * (`openapi/il-runtime.yaml`). The runtime emits compact keys (`i`, `s`, `t`,
 * `g`); the SDK normalizes them into readable fields.
 */

/** A single recalled memory chunk (normalized from the compact wire shape). */
export interface Chunk {
  /** Memory id (wire: `i`). */
  id: string;
  /** Similarity score (wire: `s`). */
  score?: number;
  /** Chunk text (wire: `t`). */
  text: string;
  /** Tags (wire: `g`). */
  tags?: string;
}

/** Usage metadata parsed from managed-cloud response headers. */
export interface MeteringMeta {
  tokensSaved?: number;
  chunksUsed?: number;
  repoCoverage?: number;
  requestId?: string;
}

/** Result of a `recall` / `investigate` call. */
export interface RecallResult {
  chunks: Chunk[];
  namespace?: string;
  metering?: MeteringMeta;
  /** True when the top match scores below the 0.85 confidence floor. */
  weak: boolean;
}

/** Result of a `remember` / `memorize` call. */
export interface RememberResult {
  memoryId?: string;
  namespace?: string;
}

/** Result of a `contextPack` call: a token-budgeted context string. */
export interface ContextPack {
  pack: string;
  tokensEstimated?: number;
  namespace?: string;
  metering?: MeteringMeta;
}

/** A memory bank descriptor. */
export interface Bank {
  namespace: string;
  count?: number;
}

export interface RecallOptions {
  namespace?: string;
  topK?: number;
  filters?: Record<string, unknown>;
  verbose?: boolean;
}

export interface InvestigateOptions {
  namespaceHint?: string;
  topK?: number;
}

export interface RememberOptions {
  namespace?: string;
  source?: string;
  tags?: string;
}

export interface ContextPackOptions {
  namespace?: string;
  maxTokens?: number;
  repoRoot?: string;
}

export interface ListRecentOptions {
  namespace?: string;
  n?: number;
}
