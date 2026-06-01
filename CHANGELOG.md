# Changelog

All notable changes to the InfoLang TypeScript SDK are documented here. This
project adheres to [Semantic Versioning](https://semver.org). The SDK minor
version tracks the `il-runtime` API version pinned in
`openapi/IL_RUNTIME_VERSION`.

## [0.1.0] - Unreleased

### Added
- Initial release: `InfoLang` client (fetch-native, async).
- Auth providers: API key, dev key (`key:namespace`), OAuth session file.
- Memory API: `recall`, `investigate`, `remember`, `memorize`, `forget`,
  `listBanks`, `listRecent`.
- Context API: `contextPack`, `ingestRepo`, `execute`.
- Typed error hierarchy, automatic retries with jitter, and metering metadata.
- Dual ESM + CJS builds with bundled type declarations.
