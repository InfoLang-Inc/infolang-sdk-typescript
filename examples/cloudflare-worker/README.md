# cloudflare-worker (edge-compat diagnostic)

Not a product example — a diagnostic Worker built to answer one question:
does `@infolang/sdk` actually run in Cloudflare Workers (workerd)? See
[`../../docs/EDGE_COMPAT.md`](../../docs/EDGE_COMPAT.md) for the verdict,
evidence, and what remains unverified.

## Run it

```bash
npm install
```

Create `.dev.vars` (gitignored) with a real InfoLang API key:

```
INFOLANG_API_KEY=il_live_...
```

```bash
npx wrangler dev --port 8787
```

```bash
curl -s http://localhost:8787/           # reports whether the SDK module loaded
curl -s http://localhost:8787/roundtrip  # live remember -> recall -> forget
```

`/roundtrip` uses a namespace prefixed `ittest-edge-` and deletes the memory
it creates before returning, regardless of success or failure.

Requires the `nodejs_compat` compatibility flag (already set in
`wrangler.jsonc`) — see `docs/EDGE_COMPAT.md` for why.
