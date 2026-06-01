/**
 * InfoLang TypeScript SDK — quickstart.
 *
 * Run against the managed cloud:
 *   INFOLANG_API_KEY=il_live_... npx tsx examples/quickstart.ts
 *
 * Or against a local runtime (il-runtime serve):
 *   INFOLANG_DEV_KEY=devsecret:default npx tsx examples/quickstart.ts
 */

import { InfoLang } from "../src/index.js";

async function main(): Promise<void> {
  // Credentials resolved from INFOLANG_API_KEY / INFOLANG_DEV_KEY.
  const il = new InfoLang();

  const result = await il.investigate("How does auth middleware work?");
  if (result.weak) console.log("(weak match — consider narrowing the query)");
  for (const chunk of result.chunks) {
    console.log(`[${chunk.score?.toFixed(2)}] ${chunk.text.slice(0, 120)}`);
  }

  await il.memorize("Auth middleware validates bearer tokens via Supabase.", {
    source: "docs/auth.md",
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
