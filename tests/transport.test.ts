import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyAuth } from "../src/auth.js";
import { InfoLangConnectionError } from "../src/errors.js";
import { parseBanks, parseRecall } from "../src/resources/ops.js";
import { Transport } from "../src/transport.js";

const BASE = "https://api.test.infolang.ai";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Transport", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("throws when fetch is unavailable", () => {
    globalThis.fetch = undefined as unknown as typeof fetch;
    expect(
      () =>
        new Transport({
          baseUrl: BASE,
          auth: new ApiKeyAuth("il_live_x"),
          userAgent: "test/0",
        }),
    ).toThrow(InfoLangConnectionError);
    globalThis.fetch = originalFetch;
  });

  it("retries 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(503, { error: "busy" });
      return jsonResponse(200, { ok: true });
    });

    const transport = new Transport({
      baseUrl: BASE,
      auth: new ApiKeyAuth("il_live_x"),
      fetch: fetchImpl as typeof fetch,
      maxRetries: 2,
      userAgent: "test/0",
    });

    const promise = transport.request<{ ok: boolean }>({ method: "GET", path: "/v1/health" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries after connection error then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return jsonResponse(200, { ok: true });
    });

    const transport = new Transport({
      baseUrl: BASE,
      auth: new ApiKeyAuth("il_live_x"),
      fetch: fetchImpl as typeof fetch,
      maxRetries: 1,
      userAgent: "test/0",
    });

    const promise = transport.request<{ ok: boolean }>({ method: "GET", path: "/v1/health" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws connection error when retries are exhausted", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const transport = new Transport({
      baseUrl: BASE,
      auth: new ApiKeyAuth("il_live_x"),
      fetch: fetchImpl as typeof fetch,
      maxRetries: 0,
      userAgent: "test/0",
    });

    await expect(
      transport.request({ method: "GET", path: "/v1/health" }),
    ).rejects.toBeInstanceOf(InfoLangConnectionError);
  });

  it("returns non-JSON body as raw text", async () => {
    const fetchImpl = vi.fn(async () => new Response("plain-text", { status: 200 }));

    const transport = new Transport({
      baseUrl: BASE,
      auth: new ApiKeyAuth("il_live_x"),
      fetch: fetchImpl as typeof fetch,
      maxRetries: 0,
      userAgent: "test/0",
    });

    const { data } = await transport.request<string>({ method: "GET", path: "/v1/health" });
    expect(data).toBe("plain-text");
  });

  it("strips trailing slash from baseUrl", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe(`${BASE}/v1/health`);
      return jsonResponse(200, {});
    });

    const transport = new Transport({
      baseUrl: `${BASE}/`,
      auth: new ApiKeyAuth("il_live_x"),
      fetch: fetchImpl as typeof fetch,
      maxRetries: 0,
      userAgent: "test/0",
    });

    await transport.request({ method: "GET", path: "/v1/health" });
  });
});

describe("ops parsers", () => {
  it("parseBanks accepts bare array and wrapped banks", () => {
    expect(parseBanks([{ namespace: "a", count: 1 }])).toEqual([
      { namespace: "a", count: 1 },
    ]);
    expect(parseBanks({ banks: [{ namespace: "b" }] })).toEqual([{ namespace: "b", count: undefined }]);
  });

  it("parseRecall returns empty chunks for empty input", () => {
    const result = parseRecall(null, {});
    expect(result.chunks).toEqual([]);
    expect(result.weak).toBe(false);
  });
});
