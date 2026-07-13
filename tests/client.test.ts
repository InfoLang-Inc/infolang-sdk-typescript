import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  InfoLang,
  InfoLangConfigError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../src/index.js";

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
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
    vi.unstubAllEnvs();
  });

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

  it("flags weak recall when top score is below 0.85", async () => {
    const { fetch } = stubFetch(() =>
      jsonResponse(200, { chunks: [{ i: "x", s: 0.5, t: "low" }] }),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    const result = await il.recall("q");
    expect(result.weak).toBe(true);
  });

  it("investigate defaults topK to 5", async () => {
    const { fetch, calls } = stubFetch(() => jsonResponse(200, { chunks: [] }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });

    await il.investigate("weak query");

    const body = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect(body.top_k).toBe(5);
  });

  it("remember stores text and parses id", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { id: "mem_1", namespace: "default" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });

    const result = await il.remember("a fact", { source: "docs/x.md" });

    expect(result.memoryId).toBe("mem_1");
  });

  it("memorize stores text and parses id", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { id: "mem_2", namespace: "default" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });

    const result = await il.memorize("a fact", { source: "docs/y.md" });

    expect(result.memoryId).toBe("mem_2");
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

  it("maps 401 to AuthenticationError", async () => {
    const { fetch } = stubFetch(() => jsonResponse(401, { error: "bad key" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, maxRetries: 0, fetch });
    await expect(il.recall("q")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("maps 400 to ValidationError", async () => {
    const { fetch } = stubFetch(() => jsonResponse(400, { error: "invalid" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, maxRetries: 0, fetch });
    await expect(il.recall("")).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 500 to ServerError", async () => {
    const { fetch } = stubFetch(() => jsonResponse(500, { error: "boom" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, maxRetries: 0, fetch });
    await expect(il.recall("q")).rejects.toBeInstanceOf(ServerError);
  });

  it("dev key defaults to the direct base URL and extracts namespace", () => {
    const il = InfoLang.fromDevKey("secret:acme");
    expect(il.baseUrl).toBe("http://127.0.0.1:8766");
    expect(il.namespace).toBe("acme");
  });

  it("throws when credentials are missing", () => {
    vi.stubEnv("INFOLANG_API_KEY", "");
    vi.stubEnv("INFOLANG_DEV_KEY", "");
    delete process.env.INFOLANG_API_KEY;
    delete process.env.INFOLANG_DEV_KEY;
    expect(() => new InfoLang()).toThrow(InfoLangConfigError);
  });

  it("constructs from session file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-client-"));
    const path = join(dir, "session.json");
    await writeFile(path, JSON.stringify({ access_token: "sess_tok" }));
    const { fetch, calls } = stubFetch(() => jsonResponse(200, { chunks: [] }));
    const il = InfoLang.fromSessionFile(path, { baseUrl: BASE_URL, fetch });
    await il.recall("q");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sess_tok");
  });

  it("contextPack requires namespace", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { pack: "ctx" }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    await expect(il.contextPack("q")).rejects.toThrow(InfoLangConfigError);
  });

  it("contextPack parses pack and metering", async () => {
    const { fetch, calls } = stubFetch(() =>
      jsonResponse(200, { pack: "packed ctx", tokens_estimated: 42, namespace: "acme" }, {
        "x-infolang-tokens-saved": "99",
      }),
    );
    const il = InfoLang.fromDevKey("secret:acme", { baseUrl: BASE_URL, fetch });
    const result = await il.contextPack("how deploy?", { maxTokens: 100 });
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/context-pack`);
    expect(result.pack).toBe("packed ctx");
    expect(result.tokensEstimated).toBe(42);
    expect(result.metering?.tokensSaved).toBe(99);
  });

  it("listBanks parses namespaces", async () => {
    const { fetch } = stubFetch(() =>
      jsonResponse(200, { banks: [{ namespace: "default", count: 3 }] }),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    const banks = await il.listBanks();
    expect(banks).toEqual([{ namespace: "default", count: 3 }]);
  });

  it("listRecent accepts bare array response", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, [{ id: "m1" }]));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, namespace: "default", fetch });
    const recent = await il.listRecent({ n: 5 });
    expect(recent).toEqual([{ id: "m1" }]);
  });

  it("listRecent unwraps memories object", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { memories: [{ id: "m2" }] }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    expect(await il.listRecent()).toEqual([{ id: "m2" }]);
  });

  it("forget uses DELETE /v1/memories/{id}", async () => {
    const { fetch, calls } = stubFetch(() => jsonResponse(200, {}));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, namespace: "ns1", fetch });
    await il.forget("mem_x");
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/memories/mem_x`);
    expect(calls[0]?.init.method).toBe("DELETE");
  });

  it("recallHybrid overfetches then applies tag ordering", async () => {
    const { fetch, calls } = stubFetch(() =>
      jsonResponse(200, {
        hits: [
          { id: "a", text: "untagged", similarity: 0.99, tags: "bob" },
          { id: "b", text: "tagged", similarity: 0.5, tags: "alice,march" },
        ],
      }),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    const result = await il.recallHybrid("q", { topK: 1, tagFilter: ["march"], candidatePool: 10 });
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/recall`);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.id).toBe("b");
  });

  it("rememberBatch posts execute remember_batch", async () => {
    const { fetch, calls } = stubFetch(() =>
      jsonResponse(200, {
        results: [
          {
            op: "remember_batch",
            ok: true,
            payload: { results: [{ id: "1" }, { id: "2" }] },
          },
        ],
      }),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, namespace: "ns", fetch });
    const out = await il.rememberBatch(["one", { text: "two", tags: ["t"] }]);
    expect(calls[0]?.url).toBe(`${BASE_URL}/v1/execute`);
    const body = JSON.parse((calls[0]?.init.body as string) ?? "{}");
    expect(body.operations[0].op).toBe("remember_batch");
    expect(out.map((r) => r.memoryId)).toEqual(["1", "2"]);
    expect(await il.rememberBatch([])).toEqual([]);
  });

  it("resetNamespace lists then forgets", async () => {
    let round = 0;
    const { fetch, calls } = stubFetch((url, init) => {
      if ((init.method ?? "GET") === "GET") {
        round += 1;
        if (round === 1) {
          return jsonResponse(200, {
            memories: [{ id: "a" }, { memory_id: "b" }, { i: "c" }, "skip", {}],
          });
        }
        return jsonResponse(200, { memories: [] });
      }
      return jsonResponse(200, {});
    });
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, namespace: "ns", fetch });
    const deleted = await il.resetNamespace("ns", { batch: 500 });
    expect(deleted).toBe(3);
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(true);
  });

  it("rememberBatch parses legacy per-op execute payloads", async () => {
    const { fetch } = stubFetch(() =>
      jsonResponse(200, {
        results: [
          { op: "remember", ok: true, payload: { id: "solo" } },
        ],
      }),
    );
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    const out = await il.rememberBatch(["x"]);
    expect(out[0]?.memoryId).toBe("solo");
  });

  it("rememberBatch rejects invalid items", async () => {
    const { fetch } = stubFetch(() => jsonResponse(200, { results: [] }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    await expect(il.rememberBatch([123 as unknown as string])).rejects.toBeInstanceOf(TypeError);
  });


  it("health wraps non-object body", async () => {
    const { fetch } = stubFetch(() => new Response("ok", { status: 200 }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    expect(await il.health.check()).toEqual({ status: "ok" });
  });

  it("ingestRepo wraps non-object body", async () => {
    const { fetch } = stubFetch(() => new Response("queued", { status: 200 }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    const result = await il.ingestRepo("acme", { repoRoot: "/repo" });
    expect(result).toEqual({ result: "queued" });
  });

  it("execute wraps non-object body", async () => {
    const { fetch } = stubFetch(() => new Response("done", { status: 200 }));
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    const result = await il.execute([{ op: "noop" }]);
    expect(result).toEqual({ results: "done" });
  });

  it("ingestRepo and execute pass JSON for object responses", async () => {
    const { fetch, calls } = stubFetch((url) => {
      if (url.includes("/ingest")) return jsonResponse(200, { job: "j1" });
      return jsonResponse(200, { results: [] });
    });
    const il = InfoLang.fromApiKey("il_live_test", { baseUrl: BASE_URL, fetch });
    expect(await il.ingestRepo("acme", { repoRoot: "/r", ref: "main" })).toEqual({ job: "j1" });
    expect(await il.execute([{ op: "x" }])).toEqual({ results: [] });
    expect(calls.some((c) => c.url.includes("/repos/acme/ingest"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/v1/execute"))).toBe(true);
  });
});
