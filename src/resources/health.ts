/** Health resource: liveness/readiness checks against the runtime. */

import type { Transport } from "../transport.js";
import * as ops from "./ops.js";

export class HealthResource {
  constructor(private readonly transport: Transport) {}

  async check(): Promise<Record<string, unknown>> {
    const { data } = await this.transport.request<unknown>(ops.buildHealth());
    return (data && typeof data === "object" ? data : { status: data }) as Record<
      string,
      unknown
    >;
  }
}
