#!/usr/bin/env bash
# Regenerate typed wire models from the pinned il-runtime OpenAPI spec.
#
# Source of truth is infolang-runtime/openapi/il-runtime.yaml. In the mesh
# layout the runtime is a sibling worktree; in CI we fetch the spec at the
# pinned tag from GitHub. Generated types land in src/generated/schema.ts and
# must not be hand-edited.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPEC="$ROOT/openapi/il-runtime.yaml"
VERSION="$(tr -d '[:space:]' <"$ROOT/openapi/IL_RUNTIME_VERSION")"
OUT="$ROOT/src/generated/schema.ts"

SIBLING="${IL_RUNTIME_DIR:-$ROOT/../runtime}/openapi/il-runtime.yaml"
RAW_URL="https://raw.githubusercontent.com/InfoLang-Inc/infolang-runtime/${VERSION}/openapi/il-runtime.yaml"

echo "Pinning il-runtime OpenAPI @ ${VERSION}"
if [ -f "$SIBLING" ]; then
  echo "  source: sibling worktree ($SIBLING)"
  cp "$SIBLING" "$SPEC"
elif command -v curl >/dev/null 2>&1; then
  echo "  source: $RAW_URL"
  curl -fsSL "$RAW_URL" -o "$SPEC" || echo "  (fetch failed — keeping existing $SPEC)"
fi

mkdir -p "$(dirname "$OUT")"
npx --yes openapi-typescript "$SPEC" -o "$OUT"
echo "Wrote $OUT"
