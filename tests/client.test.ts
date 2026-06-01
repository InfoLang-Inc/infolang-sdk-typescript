import { describe, expect, it } from "vitest";

import { InfoLang, NotFoundError, RateLimitError } from "../src/index.js";

const BASE_URL = "https://api.test.infolang.ai";

/** Build a fetch stub that records requests and returns canned responses. */
function stubFetch(handler: (url: string, init: RequestInit) => Response): {
  fetch: typeof fetch;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("InfoLang client", () => {
  it("recall parses compact chunks and metering headers", async () => {
    const { fetch, calls } = stubFetch(() =>
      jsonResponse(
        200,
        {
          namespace: "default",
          chunks: [
            { i: "abc", s: 0.91, t: "auth middleware uses bearer tokens" },
            { i: "def", s: 0.42, t: "unrelated" },
          ],
        },
        {
          "x-infolang-tokens-saved": "1200",
          "x-infolang-chunks-used": "3",
          "x-request-id": "req_123",
        },
      ),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, namespace: "default", fetch });

    const result = await il.recall("how does auth work?", { topK: 2 });

    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/recall`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer il_live_test");
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]?.id).toBe("abc");
    expect(result.chunks[0]?.score).toBe(0.91);
    expect(result.weak).toBe(false);
    expect(result.metering?.tokensSaved).toBe(1200);
    expect(result.metering?.requestId).toBe("req_123");
  });

  it("investigate defaults topK to 5", async () => {
    const { fetch, calls } = stubFetch(() => jsonResponse(200, { chunks: [] }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });

    await il.investigate("weak query");

    const body = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect(body.top_k).toBe(5);
  });

  it("memorize stores text and parses id", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { id: "mem_1", namespace: "default" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });

    const result = await il.memorize("a fact", { source: "docs/x.md" });

    expect(result.memoryId).toBe("mem_1");
  });

  it("maps 404 to NotFoundError", async () => {
    const { fetch } = stubFetch(() => jsonResponse(404, { error: "no such memory" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });

    await expect(il.forget("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("maps 429 to RateLimitError with retryAfter", async () => {
    const { fetch } = stubFetch(() =>
      jsonResponse(429, { error: "slow down" }, { "retry-after": "1" }),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, maxRetries: 0, fetch });

    await expect(il.recall("q")).rejects.toMatchObject({ retryAfter: 1 });
    await expect(il.recall("q")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("dev key defaults to the direct base URL and extracts namespace", () => {
    const il = InfoLang.fromDevKey("secret:acme");
    expect(il.baseUrl).toBe("http://127.0.0.1:8766");
    expect(il.namespace).toBe("acme");
  });
});
