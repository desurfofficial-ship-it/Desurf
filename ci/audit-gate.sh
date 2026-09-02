#!/usr/bin/env bash
# Desurf release audit gate (RFC-002 H4).
# Run from the repo root of the release checkout.
# Env: AUDIT_TAG (optional) — e.g. v0.9.0; defaults to v${package.json version}.
set -euo pipefail

fail_block() {
  local reason="$1"
  echo "AUDIT GATE FAILED: ${reason}"
  echo ""
  echo "Create/fix the audit document for this release:"
  echo "  docs/audits/v${PKG_VERSION:-<version>}.md"
  echo ""
  echo "Required machine-checked lines (exact):"
  echo "  AUDIT-VERDICT: PASS"
  echo "  Audited-commit: <full sha of the release commit>"
  echo ""
  echo "See docs/audits/TEMPLATE.md for the full checklist."
  exit 1
}

# --- Step 1: resolve version ---
if [ ! -f package.json ]; then
  PKG_VERSION="?"
  fail_block "package.json not found in $(pwd)"
fi
PKG_VERSION="$(node -p "require('./package.json').version")"
TAG="${AUDIT_TAG:-}"
if [ -z "$TAG" ]; then
  TAG="v${PKG_VERSION}"
fi
if [ "${TAG#v}" != "$PKG_VERSION" ]; then
  fail_block "Release tag ${TAG} does not match package.json version ${PKG_VERSION}"
fi

# --- Step 2: doc exists ---
DOC="docs/audits/v${PKG_VERSION}.md"
if [ ! -f "$DOC" ]; then
  fail_block "missing audit document ${DOC}"
fi

# --- Step 3: verdict line ---
if ! grep -E '^[[:space:]]*AUDIT-VERDICT:[[:space:]]*PASS[[:space:]]*$' "$DOC" >/dev/null; then
  fail_block "${DOC} must contain a line: AUDIT-VERDICT: PASS"
fi
# Any AUDIT-VERDICT line that is not PASS fails
while IFS= read -r line || [ -n "$line" ]; do
  if echo "$line" | grep -E '^[[:space:]]*AUDIT-VERDICT:' >/dev/null; then
    if ! echo "$line" | grep -E '^[[:space:]]*AUDIT-VERDICT:[[:space:]]*PASS[[:space:]]*$' >/dev/null; then
      fail_block "${DOC} has non-PASS AUDIT-VERDICT line: ${line}"
    fi
  fi
done < "$DOC"

# --- Step 4: audited commit is ancestor of HEAD ---
SHA_LINE="$(grep -E '^[[:space:]]*Audited-commit:[[:space:]]*[0-9a-fA-F]{7,40}[[:space:]]*$' "$DOC" | head -n1 || true)"
if [ -z "$SHA_LINE" ]; then
  fail_block "${DOC} missing Audited-commit: <sha> line (ancestor of HEAD required)"
fi
SHA="$(echo "$SHA_LINE" | sed -E 's/^[[:space:]]*Audited-commit:[[:space:]]*([0-9a-fA-F]{7,40})[[:space:]]*$/\1/')"
if ! git rev-parse --verify "${SHA}^{commit}" >/dev/null 2>&1; then
  fail_block "Audited-commit ${SHA} does not resolve to a commit (must be an ancestor of HEAD)"
fi
if ! git merge-base --is-ancestor "$SHA" HEAD; then
  fail_block "Audited-commit ${SHA} is not an ancestor of HEAD (inclusive)"
fi

echo "AUDIT GATE PASS: version=${PKG_VERSION} doc=${DOC} audited-commit=${SHA}"
exit 0
