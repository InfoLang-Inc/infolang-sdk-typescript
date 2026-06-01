/** Context resource: context-pack, repo ingest, and batch execute. */

import { InfoLangConfigError } from "../errors.js";
import type { Transport } from "../transport.js";
import type { ContextPack, ContextPackOptions } from "../types.js";
import * as ops from "./ops.js";

export class ContextResource {
  constructor(
    private readonly transport: Transport,
    private readonly defaultNamespace?: string,
  ) {}

  async contextPack(query: string, options: ContextPackOptions = {}): Promise<ContextPack> {
    const namespace = options.namespace ?? this.defaultNamespace;
    if (!namespace) {
      throw new InfoLangConfigError(
        "contextPack requires a namespace (set one on the client or pass it)",
      );
    }
    const { data, metering } = await this.transport.request<unknown>(
      ops.buildContextPack(query, {
        namespace,
        maxTokens: options.maxTokens,
        repoRoot: options.repoRoot,
      }),
    );
    return ops.parseContextPack(data, metering);
  }

  async ingestRepo(
    namespace: string,
    options: { repoRoot: string; ref?: string },
  ): Promise<Record<string, unknown>> {
    const { data } = await this.transport.request<unknown>(
      ops.buildIngestRepo(namespace, options),
    );
    return (data && typeof data === "object" ? data : { result: data }) as Record<string, unknown>;
  }

  async execute(operations: Record<string, unknown>[]): Promise<Record<string, unknown>> {
    const { data } = await this.transport.request<unknown>(ops.buildExecute(operations));
    return (data && typeof data === "object" ? data : { results: data }) as Record<
      string,
      unknown
    >;
  }
}
