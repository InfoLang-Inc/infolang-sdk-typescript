# Edge / Workers runtime compatibility

Status: **verified 2026-07-13**. This document is the source of truth for any
public claim about `@infolang/sdk` running in edge runtimes. Do not claim
anything beyond what is written here without re-running the verification.

## Verdict

**Runs in Cloudflare Workers (workerd), conditionally on the `nodejs_compat`
compatibility flag.** A live `remember → recall → forget` round-trip against
the production API (`https://api.infolang.ai/v1`) succeeded in `wrangler dev`
(local workerd, no Cloudflare account or deploy involved) after one 1-line
SDK fix (below), which is included in this repo as of this change.

**Without `nodejs_compat`, the SDK fails to build at all** — not a soft
runtime warning, a hard `esbuild` resolution error. So the correct claim is
qualified: *"runs in Cloudflare Workers with `nodejs_compat` enabled"*, not
*"edge-native, zero Node dependency."* See [Marketing claim](#marketing-claim-assessment)
below.

## What was tested vs. not tested

| Runtime | Status |
|---|---|
| Cloudflare Workers / workerd, via `wrangler dev` (local), `nodejs_compat` on | **Verified** — real HTTP round-trip against prod API |
| Cloudflare Workers, deployed (`wrangler deploy`, live edge) | **Untested** — out of scope per task (no deploy required/permitted for this check); `wrangler dev` uses the same workerd runtime, so deployed behavior is expected to match, but this is not proven |
| Cloudflare Workers, `nodejs_compat` **off** (default) | **Verified failing** — build-time error, see below |
| Deno Deploy | **Untested / unverified** — do not claim compatibility |
| Vercel Edge Runtime | **Untested / unverified** — do not claim compatibility |
| Bun | **Untested / unverified** |
| Browser (bundled via webpack/vite/rollup) | **Untested** — `src/auth.ts`'s unconditional `node:fs` / `node:os` / `node:path` imports (see below) will almost certainly break browser bundling the same way they break workerd without a Node-compat shim; not verified either way |

## Static audit findings

`@infolang/sdk` 0.2.0 has **zero runtime `dependencies`** in `package.json`
(fetch-native by design — confirmed in `AGENTS.md`: "Keep zero runtime
dependencies — fetch only"). `tsup.config.ts` builds dual ESM+CJS to
`dist/index.js` / `dist/index.cjs`, target `es2022`, single entry
(`src/index.ts`). `package.json` `exports` has only `types` / `import` /
`require` conditions — **no `worker`, `browser`, or `edge-light` condition**,
so every consumer (Node, Workers, browser) resolves the exact same bundle.

Two things are relevant to edge compatibility:

### 1. `src/auth.ts` imports Node built-ins, and they're in the default export graph

```ts
// src/auth.ts
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_SESSION_PATH = join(homedir(), ".config", "infolang", "session.json");
```

This is `SessionFileAuth`, the OAuth-session-file provider used by
`npx @infolang/cursor-setup` (reads `~/.config/infolang/session.json`). It's
inherently Node/filesystem-only — that's correct for its use case — but it's
exported from the single public entry point (`src/index.ts` re-exports
`SessionFileAuth` and `DEFAULT_SESSION_PATH` from `./auth.js`), so **every**
consumer's bundle pulls it in, including `ApiKeyAuth`-only consumers who never
touch it.

tsup strips the `node:` prefix during bundling (`node:fs/promises` → bare
`fs/promises` in both `dist/index.js` and `dist/index.cjs`), but the imports
remain top-level, unconditional `import` statements — confirmed directly in
the built output:

```
dist/index.js:1:import { readFile, writeFile } from 'fs/promises';
dist/index.js:2:import { homedir } from 'os';
dist/index.js:3:import { join } from 'path';
```

`DEFAULT_SESSION_PATH` also calls `homedir()` and `join()` **at module
top-level** (module-init time, not lazily inside a constructor), so even
tree-shaking a bundler that recognizes `SessionFileAuth` is unused can't
help — the `fs`/`os`/`path` imports execute (or fail to resolve) the moment
the module loads.

**Effect in workerd:** `wrangler dev` without `nodejs_compat` fails at build
time (`esbuild` can't resolve `fs/promises` / `os` / `path` — they don't
exist in workerd unless the compat flag is set). See reproduction below.

**Fix size:** larger than the fixed transport bug below. The real fix is
splitting `SessionFileAuth`/`DEFAULT_SESSION_PATH` out of the root entry
point (e.g. a `@infolang/sdk/node` subpath export, or a `sideEffects`-safe
lazy `homedir()`/`join()` call inside the constructor plus conditional
`exports` map so edge/browser bundlers never see the Node import at all).
That touches the package's public API surface and build config — **not**
done here per the "no large refactors" scope for this task. Documented as
the primary gap.

### 2. `src/transport.ts` detached `globalThis.fetch` — fixed

```ts
// before
this.fetchImpl = options.fetch ?? globalThis.fetch;
```

Workerd (and some other runtimes) brand-checks `fetch`'s receiver; storing a
detached reference and calling it later (`this.fetchImpl(url, ...)`) throws:

```
InfoLangConnectionError: Illegal invocation: function called with incorrect
`this` reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
```

This is a well-known workerd gotcha (destructuring/reassigning the global
`fetch` loses its native binding). It reproduced 100% of the time on the
first live round-trip attempt (with `nodejs_compat` on, module import
succeeded, but every HTTP call failed with this error).

**Fixed** (1 line, `src/transport.ts`):

```ts
// after
this.fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
```

All 57 existing tests pass unchanged after the fix (`npm test` — 4 files, 57
tests, 99.6% stmt coverage). Re-ran the live Worker round-trip after
rebuilding `dist/`; it now succeeds end-to-end (evidence below). Without this
fix, the SDK is non-functional in Workers even with `nodejs_compat` enabled
— every request throws before touching the network. This was a real,
previously-unverified bug, not a hypothetical.

## Reproduction

Diagnostic Worker: `examples/cloudflare-worker/`. Not a product example —
built specifically for this check. `GET /` reports whether the SDK module
evaluated without throwing; `GET /roundtrip` performs a real
`remember → recall → forget` against production, in a namespace prefixed
`ittest-edge-`, and deletes it before returning.

```bash
cd examples/cloudflare-worker
npm install                     # @infolang/sdk resolves via file:../.. (symlink to the repo build)
# .dev.vars (gitignored): INFOLANG_API_KEY=<a live API key>
npx wrangler dev --port 8787
```

```bash
curl -s http://localhost:8787/
curl -s http://localhost:8787/roundtrip
```

### Evidence: without `nodejs_compat` (build-time failure)

`wrangler.jsonc` with no `compatibility_flags`:

```
✘ [ERROR] Build failed with 3 errors:
  ✘ [ERROR] Could not resolve "fs/promises"
      ../../dist/index.js:1:36:
      1 │ import { readFile, writeFile } from 'fs/promises';
    The package "fs/promises" wasn't found on the file system but is built into node.
    - Add the "nodejs_compat" compatibility flag to your project.
  ✘ [ERROR] Could not resolve "os"
  ✘ [ERROR] Could not resolve "path"
```

`wrangler dev` never starts a local server in this state — the Worker cannot
be built at all.

### Evidence: with `nodejs_compat`, before the fetch fix

Module import succeeds; every network call fails:

```json
GET /
{ "ok": true, "importError": null }

GET /roundtrip
{
  "ok": false,
  "namespace": "ittest-edge-1783984882945",
  "steps": {},
  "error": "InfoLangConnectionError: Illegal invocation: function called with incorrect `this` reference. See https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors for details."
}
```

### Evidence: with `nodejs_compat`, after the fetch fix (current state)

```json
GET /
{
  "ok": true,
  "importError": null,
  "runtime": "workerd (wrangler dev)",
  "nodejsCompat": true
}

GET /roundtrip
{
  "ok": true,
  "namespace": "ittest-edge-1783985075762",
  "steps": {
    "remember": { "memoryId": "f9beb3a64b24", "namespace": "default" },
    "recall": {
      "chunks": [],
      "namespace": "ittest-edge-1783985075762",
      "metering": { "requestId": "076bc76b00000055" },
      "weak": false
    },
    "forget": { "ok": true, "memoryId": "f9beb3a64b24" }
  }
}
```

Round-trip succeeded end-to-end against the live production API from inside
workerd. `remember` and `forget` both returned success (`memoryId` assigned
then deleted); confirmed no residual data via `list_recent` on both the
`default` namespace (where the API stored it, per the response) and the
requested `ittest-edge-*` namespace after the run — zero leftover memories
in either.

Note: `remember`'s response reported `"namespace": "default"` rather than
the requested `ittest-edge-*` namespace — a server-side behavior of this API
key's scoping, unrelated to the SDK or its edge-compat behavior. `forget`
(`DELETE /v1/memories/{id}`) is auth-scoped, not namespace-scoped
(`src/resources/ops.ts` `buildForget`), so cleanup succeeded regardless.
Flagged here for whoever owns the runtime/auth side; not an SDK bug.

Versions used: Node v25.4.0 (dev host, not the runtime under test), Wrangler
4.110.0, `@infolang/sdk` 0.2.0 built from commit `65e3087` +
this change's `transport.ts` fix.

## Marketing claim assessment

**"Edge-native" (unqualified) is not defensible as-is.** The SDK requires
`nodejs_compat` to build at all in Workers; without it, the package cannot
be imported, let alone used. That is a materially different claim from "no
Node dependency" / "edge-native by design."

**What is defensible, precisely:**

> `@infolang/sdk` runs in Cloudflare Workers (with the `nodejs_compat`
> compatibility flag) — verified with a live `remember/recall/forget`
> round-trip against the production API in `wrangler dev`.

This is still a real, unclaimed differentiator versus Mem0 (documented
broken in edge runtimes regardless of flags — Node-native SQLite/filesystem
dependencies baked into the core storage path, per mem0ai/mem0#3515), since
InfoLang's core transport is fetch-only and the only blocker is one
opt-in build flag plus a since-fixed SDK bug. But do not claim:

- "No configuration needed" — `nodejs_compat` is required.
- "Runs in Deno Deploy / Vercel Edge / browsers" — untested, no evidence either way.
- "Deployed and verified on Cloudflare's edge network" — only `wrangler dev`
  (local workerd) was exercised; a real `wrangler deploy` was intentionally
  out of scope for this pass.

**Recommended follow-up** (not done here, tracked as a gap): drop the
`nodejs_compat` requirement entirely by moving `SessionFileAuth` /
`DEFAULT_SESSION_PATH` out of the root `@infolang/sdk` entry point (subpath
export, e.g. `@infolang/sdk/node`, or conditional `exports` with a
`worker`/`browser` condition that excludes it). That would let "edge-native,
zero configuration" become true and testable. Until that ships, use the
qualified claim above.
