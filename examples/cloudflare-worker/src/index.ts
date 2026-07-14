/**
 * Edge-compatibility probe for @infolang/sdk.
 *
 * Not a product example — a diagnostic Worker used to verify whether the
 * SDK's module graph loads and executes a real remember -> recall -> forget
 * round-trip inside workerd (via `wrangler dev`, no nodejs_compat flag).
 *
 * GET  /        -> reports whether the SDK module evaluated without throwing
 * GET  /roundtrip -> remember -> recall -> forget against api.infolang.ai,
 *                    using a namespace prefixed "ittest-edge-" that is
 *                    deleted at the end of the request regardless of outcome.
 */

export interface Env {
  INFOLANG_API_KEY: string;
}

// Import at module top level on purpose: this is exactly how a real
// consumer's bundler would evaluate the package, and it's where a stray
// node:fs / node:os / node:path import would throw during module init
// (before any handler runs).
let importError: string | null = null;
let InfoLangCtor: typeof import("@infolang/sdk").InfoLang | undefined;
try {
  const mod = await import("@infolang/sdk");
  InfoLangCtor = mod.InfoLang;
} catch (err) {
  importError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: importError === null,
        importError,
        runtime: "workerd (wrangler dev)",
        nodejsCompat: true, // see wrangler.jsonc compatibility_flags; required, see docs/EDGE_COMPAT.md
      });
    }

    if (url.pathname === "/roundtrip") {
      if (importError !== null || !InfoLangCtor) {
        return json({ ok: false, stage: "import", error: importError }, 500);
      }

      const namespace = `ittest-edge-${Date.now()}`;
      const steps: Record<string, unknown> = {};
      let memoryId: string | undefined;

      try {
        const il = new InfoLangCtor({
          apiKey: env.INFOLANG_API_KEY,
          namespace,
        });

        const remembered = await il.memorize("edge-compat probe: Cloudflare Workers round-trip test.", {
          source: "edge-compat-probe",
        });
        steps.remember = remembered;
        memoryId = remembered?.memoryId;

        const recalled = await il.recall("edge-compat probe");
        steps.recall = recalled;

        if (memoryId) {
          await il.memory.forget(memoryId);
          steps.forget = { ok: true, memoryId };
        } else {
          steps.forget = { ok: false, reason: "no memoryId returned from remember" };
        }

        return json({ ok: true, namespace, steps });
      } catch (err) {
        return json(
          {
            ok: false,
            namespace,
            steps,
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          },
          500,
        );
      }
    }

    return json({ error: "not found" }, 404);
  },
};
