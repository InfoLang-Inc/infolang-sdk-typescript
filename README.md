# InfoLang TypeScript SDK

Official TypeScript client for [InfoLang](https://infolang.ai) semantic memory.
Wraps the `il-runtime` REST API (Forge-compatible) with one-line construction,
typed errors, automatic retries, and ergonomic agent helpers. `fetch`-native —
runs on Node 18+, Bun, Deno, Cloudflare Workers, and browsers.

> Repository: `infolang-sdk-typescript`. Package: `@infolang/sdk` (npm).

## Install

While the package is private, install from the repo:

```bash
npm install github:InfoLang-Inc/infolang-sdk-typescript#v0.1.0
```

Once published:

```bash
npm install @infolang/sdk
```

## Quickstart

```ts
import { InfoLang } from "@infolang/sdk";

const il = InfoLang.fromApiKey("il_live_...");          // managed cloud
const result = await il.investigate("How does auth middleware work?");
for (const chunk of result.chunks) console.log(chunk.score, chunk.text);
```

Three ways to call, depending on your runtime:

```ts
// 1. One-shot
const { chunks } = await InfoLang.fromApiKey("il_live_...").investigate("query");

// 2. OAuth via ~/.config/infolang/session.json
const il = InfoLang.fromSessionFile();
await il.memorize("a fact worth keeping", { source: "docs/auth.md" });

// 3. Self-hosted dev runtime
const local = InfoLang.fromDevKey("devsecret:default");
const recent = await local.listRecent({ n: 10 });
```

## Authentication

| Mode | Constructor | Target |
|------|-------------|--------|
| Managed cloud (API key) | `InfoLang.fromApiKey("il_live_...")` | `api.infolang.ai` |
| Managed cloud (OAuth) | `InfoLang.fromSessionFile()` | `api.infolang.ai` |
| Self-hosted dev | `InfoLang.fromDevKey("key:namespace")` | `127.0.0.1:8766` |

Credentials are also read from the environment: `INFOLANG_API_KEY`,
`INFOLANG_DEV_KEY`, `INFOLANG_BASE_URL`, `INFOLANG_NAMESPACE`.

Enterprise mTLS is not yet first-class in the TypeScript SDK because the Fetch
standard does not expose client-certificate configuration. Pass a custom
`fetch` (backed by a Node `https.Agent` with `cert`/`key`) via the `fetch`
option to use mTLS today; the Python SDK supports `InfoLang.from_mtls(...)`
directly.

## Core API

| Method | Purpose |
|--------|---------|
| `recall(query, { namespace, topK, filters, verbose })` | Semantic recall |
| `investigate(query, { namespaceHint, topK = 5 })` | Agent-style recall |
| `remember(text, { source, tags, namespace })` | Store a memory |
| `memorize(content, { source, tags, namespace })` | Alias of `remember` |
| `forget(memoryId, { namespace })` | Delete a memory |
| `listBanks()` / `listRecent({ namespace, n })` | Introspection |
| `contextPack(query, { namespace, maxTokens, repoRoot })` | One-shot context string |
| `ingestRepo(namespace, { repoRoot, ref })` | Index a repository |
| `execute(operations)` | Batch ops |
| `health.check()` | Liveness/readiness |

## Errors

All failures throw a subclass of `InfoLangError`: `AuthenticationError`,
`RateLimitError` (with `retryAfter`), `NotFoundError`, `ValidationError`,
`ServerError`, plus `InfoLangConnectionError` for transport failures. Every API
error carries `status`, `body`, and `requestId`.

## Resilience

`recall`/`remember` and friends retry `429` and `5xx` with exponential backoff
plus full jitter (configurable via `maxRetries`), honor `Retry-After`, and abort
on the timeout budget (default 30s, set via `timeoutMs`).

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

The REST contract is pinned in `openapi/` (see `openapi/IL_RUNTIME_VERSION`).
Regenerate types with `npm run codegen` after bumping the pin.
