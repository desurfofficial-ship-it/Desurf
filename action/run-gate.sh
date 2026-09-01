#!/usr/bin/env bash
set -euo pipefail
VER="${DESURF_VERSION:-}"
if [ -z "$VER" ] && [ -n "${DESURF_PACKAGE_VERSION:-}" ]; then VER="$DESURF_PACKAGE_VERSION"; fi
if [ -z "$VER" ] || [ "$VER" = "latest" ]; then
  echo "Desurf Action error: package version must be an explicit semver (got '${VER:-empty}'). Do not use 'latest'." >&2
  exit 2
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Desurf Action error: Node >=18 required (got $(node -v 2>/dev/null || echo unknown); input node-version=${DESURF_NODE_VERSION:-})" >&2
  exit 2
fi
SUITE="${DESURF_SUITE:-}"
if [ -z "$SUITE" ]; then echo "Desurf Action error: input 'suite' is required" >&2; exit 2; fi
if [ ! -e "$SUITE" ]; then echo "Desurf Action error: suite path not found: $SUITE" >&2; exit 2; fi
SUITE_ABS=$(cd "$(dirname "$SUITE")" && pwd)/$(basename "$SUITE")
PROVIDER="${DESURF_PROVIDER:-}"; MODEL="${DESURF_MODEL:-}"; REPEAT="${DESURF_REPEAT:-1}"
TIMEOUT_MS="${DESURF_TIMEOUT_MS:-}"; MAX_RETRIES="${DESURF_MAX_RETRIES:-}"
if [ -n "$PROVIDER" ]; then
  case "$PROVIDER" in openrouter|openai|anthropic|gemini|google) ;; 
    *) echo "Desurf Action error: unknown provider '${PROVIDER}'. Supported: openrouter, openai, anthropic, gemini" >&2; exit 2;;
  esac
fi
if ! [[ "$REPEAT" =~ ^[0-9]+$ ]] || [ "$REPEAT" -lt 1 ] || [ "$REPEAT" -gt 100 ]; then
  echo "Desurf Action error: repeat must be an integer between 1 and 100 (got '${REPEAT}')" >&2; exit 2
fi
PKG="@desurfofficial-ship-it/desurf"; SPEC="${PKG}@${VER}"
if [ "${DESURF_SKIP_INSTALL:-}" = "1" ]; then
  DESURF_BIN="${DESURF_BIN:-desurf}"
else
  INSTALL_DIR=$(mktemp -d); trap 'rm -rf "$INSTALL_DIR"' EXIT
  npm install --prefix "$INSTALL_DIR" --no-save --no-package-lock "$SPEC"
  DESURF_BIN="$INSTALL_DIR/node_modules/.bin/desurf"
  if [ ! -x "$DESURF_BIN" ]; then echo "Desurf Action error: desurf binary not found after install" >&2; exit 2; fi
fi
if [ -n "$PROVIDER" ]; then
  echo "Desurf live gate"; echo "  package:  $SPEC"; echo "  suite:    $SUITE_ABS"; echo "  provider: $PROVIDER"
  [ -n "$MODEL" ] && echo "  model:    $MODEL"; echo "  repeat:   $REPEAT"
  CMD=("$DESURF_BIN" test --suite "$SUITE_ABS" --provider "$PROVIDER" --repeat "$REPEAT")
  [ -n "$MODEL" ] && CMD+=(--model "$MODEL")
  [ -n "$TIMEOUT_MS" ] && CMD+=(--timeout-ms "$TIMEOUT_MS")
  [ -n "$MAX_RETRIES" ] && CMD+=(--max-retries "$MAX_RETRIES")
  "${CMD[@]}"
else
  echo "Desurf offline gate"; echo "  package:  $SPEC"; echo "  suite:    $SUITE_ABS"; echo "  provider: offline (default)"
  "$DESURF_BIN" test --suite "$SUITE_ABS"
fi
