import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiKeyAuth,
  DevKeyAuth,
  OriginAuth,
  SessionFileAuth,
} from "../src/auth.js";
import { InfoLangConfigError } from "../src/errors.js";

describe("auth providers", () => {
  it("rejects empty ApiKeyAuth", () => {
    expect(() => new ApiKeyAuth("")).toThrow(InfoLangConfigError);
  });

  it("parses DevKeyAuth token and namespace", async () => {
    const auth = new DevKeyAuth("secret:acme");
    expect(auth.namespace).toBe("acme");
    expect((await auth.headers()).Authorization).toBe("Bearer secret");
  });

  it("rejects DevKeyAuth without namespace separator", () => {
    expect(() => new DevKeyAuth("nocolon")).toThrow(InfoLangConfigError);
  });

  it("sets OriginAuth headers", async () => {
    const auth = new OriginAuth("ws_1", "shh");
    expect(await auth.headers()).toEqual({
      "X-InfoLang-Workspace": "ws_1",
      "X-InfoLang-Origin-Secret": "shh",
    });
  });

  it("reads access_token from session file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-auth-"));
    const path = join(dir, "session.json");
    await writeFile(path, JSON.stringify({ access_token: "tok_live" }));
    const auth = new SessionFileAuth(path);
    expect((await auth.headers()).Authorization).toBe("Bearer tok_live");
  });

  it("throws when session file is missing", async () => {
    const auth = new SessionFileAuth(join(tmpdir(), "missing-session.json"));
    await expect(auth.headers()).rejects.toThrow(InfoLangConfigError);
    await expect(auth.headers()).rejects.toThrow(/not found/);
  });

  it("throws when session file is invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-auth-"));
    const path = join(dir, "session.json");
    await writeFile(path, "not-json");
    const auth = new SessionFileAuth(path);
    await expect(auth.headers()).rejects.toThrow(/not valid JSON/);
  });

  it("throws when session file lacks access_token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-auth-"));
    const path = join(dir, "session.json");
    await writeFile(path, JSON.stringify({ refresh_token: "rt" }));
    const auth = new SessionFileAuth(path);
    await expect(auth.headers()).rejects.toThrow(/access_token/);
  });
});

describe("SessionFileAuth refresh", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("refreshes expired tokens and persists session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-refresh-"));
    const path = join(dir, "session.json");
    const tokenUrl = "https://oauth.test/token";
    await writeFile(
      path,
      JSON.stringify({
        access_token: "old_tok",
        refresh_token: "rt_1",
        token_url: tokenUrl,
        expires_at: Math.floor(Date.now() / 1000) - 60,
      }),
    );

    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === tokenUrl) {
        return new Response(
          JSON.stringify({
            access_token: "new_tok",
            refresh_token: "rt_2",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const auth = new SessionFileAuth(path);
    expect((await auth.headers()).Authorization).toBe("Bearer new_tok");

    const saved = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
    expect(saved.access_token).toBe("new_tok");
    expect(saved.refresh_token).toBe("rt_2");
    expect(typeof saved.expires_at).toBe("number");
  });

  it("uses refreshed token in memory when session file cannot be written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-refresh-ro-"));
    const path = join(dir, "session.json");
    const tokenUrl = "https://oauth.test/token-ro";
    await writeFile(
      path,
      JSON.stringify({
        access_token: "old_tok",
        refresh_token: "rt_1",
        token_url: tokenUrl,
        expires_at: Math.floor(Date.now() / 1000) - 60,
      }),
    );
    await chmod(path, 0o400);

    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === tokenUrl) {
        return new Response(
          JSON.stringify({ access_token: "mem_tok", expires_in: 120 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const auth = new SessionFileAuth(path);
    expect((await auth.headers()).Authorization).toBe("Bearer mem_tok");

    const onDisk = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8"));
    expect(onDisk.access_token).toBe("old_tok");

    await chmod(path, 0o600);
  });

  it("keeps prior session when refresh endpoint fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-refresh-fail-"));
    const path = join(dir, "session.json");
    const tokenUrl = "https://oauth.test/token-fail";
    await writeFile(
      path,
      JSON.stringify({
        access_token: "still_ok",
        refresh_token: "rt_1",
        token_url: tokenUrl,
        expires_at: Math.floor(Date.now() / 1000) - 60,
      }),
    );

    globalThis.fetch = vi.fn(async (input) => {
      if (String(input) === tokenUrl) {
        return new Response("denied", { status: 401 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    const auth = new SessionFileAuth(path);
    expect((await auth.headers()).Authorization).toBe("Bearer still_ok");
  });
});
