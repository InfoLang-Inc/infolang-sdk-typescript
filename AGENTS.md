# infolang-sdk-typescript — agent instructions

Official **TypeScript SDK** for InfoLang semantic memory. Wraps the `il-runtime`
REST API. Package name: `@infolang/sdk`. fetch-native, no runtime deps.

## Architecture

- `src/client.ts` — `InfoLang` facade with `from*` constructors + aliases.
- `src/transport.ts` — fetch transport: retries, timeout (AbortController), error mapping.
- `src/auth.ts` — credential providers (API key, dev key, session file, origin).
- `src/resources/` — `memory`, `context`, `health`; request shaping in `ops.ts`.
- `src/errors.ts` / `types.ts` — typed errors and normalized models.

## Contract

The REST contract is the source of truth in `infolang-runtime`
(`openapi/il-runtime.yaml`). This repo pins a copy under `openapi/`; the pinned
version is in `openapi/IL_RUNTIME_VERSION`. Run `npm run codegen` after a bump.

## Rules

- Keep zero runtime dependencies — `fetch` only. Dev deps are fine.
- New endpoints: add a builder + parser in `resources/ops.ts`, the resource
  method, then the top-level alias on `InfoLang`.
- Normalize the runtime's compact keys (`i`/`s`/`t`/`g`) into readable fields.
- Keep `src/version.ts` in sync with `package.json`.

## Commands

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
```
