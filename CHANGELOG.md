# Changelog

All notable changes to the InfoLang TypeScript SDK are documented here. This
project adheres to [Semantic Versioning](https://semver.org). The SDK minor
version tracks the `il-runtime` API version pinned in
`openapi/IL_RUNTIME_VERSION`.

## [Unreleased]

### Fixed
- `Transport` no longer detaches `globalThis.fetch` from its receiver
  (`fetch?.bind(globalThis)`), which threw `Illegal invocation` in
  Cloudflare Workers (workerd) and any runtime that brand-checks `fetch`.
  Found and fixed during edge-runtime verification — see
  `docs/EDGE_COMPAT.md`.

## [0.2.0] - 2026-07-13

### Changed
- Pinned OpenAPI contract to **v0.2.0** (runtime-aligned).
- `forget(memoryId)` now calls `DELETE /v1/memories/{id}` (was `POST /v1/forget`).
- `listRecent({ n })` now calls `GET /v1/memories?limit=` (was `GET /v1/recent`).

### Added
- `parseRecall` maps runtime `hits` → `chunks` (fixes empty recall results).
- Parity with Python: `recallHybrid`, `rememberBatch`, `resetNamespace`.
- npm publish workflow with provenance.

## [0.1.0] - Unreleased

### Added
- Initial release: `InfoLang` client (fetch-native, async).
- Auth providers: API key, dev key (`key:namespace`), OAuth session file.
- Memory API: `recall`, `investigate`, `remember`, `memorize`, `forget`,
  `listBanks`, `listRecent`.
- Context API: `contextPack`, `ingestRepo`, `execute`.
- Typed error hierarchy, automatic retries with jitter, and metering metadata.
- Dual ESM + CJS builds with bundled type declarations.
