#!/usr/bin/env bash
# desurf drift-watch helpers — pure bash + jq + gh (available on GitHub runners)
# Usage (from workflow):
#   source lib.sh
#   CLASS=$(classify_run summary.json)
#   act "$CLASS" "$SUITE_NAME" summary.json "$CONTEXT_JSON"

set -euo pipefail

# classify_run <summary.json>
# Prints one word: drift|infra|flaky|healthy. Exit 0 always for classified results.
# Corrupt/missing JSON → infra (fail closed toward infra, never drift/healthy).
classify_run() {
  local summary="${1:-}"
  if [ -z "$summary" ] || [ ! -f "$summary" ]; then
    echo "infra"
    return 0
  fi
  if ! jq -e '.cases | type == "array"' "$summary" >/dev/null 2>&1; then
    echo "infra"
    return 0
  fi
  # Precedence: REGRESSION > ERROR > FLAKY > healthy
  if jq -e '.cases[] | select(.state == "REGRESSION")' "$summary" >/dev/null 2>&1; then
    echo "drift"
    return 0
  fi
  if jq -e '.cases[] | select(.state == "ERROR")' "$summary" >/dev/null 2>&1; then
    echo "infra"
    return 0
  fi
  if jq -e '.cases[] | select(.state == "FLAKY")' "$summary" >/dev/null 2>&1; then
    echo "flaky"
    return 0
  fi
  echo "healthy"
  return 0
}

# Internal: suite fingerprint for matching open issues (suiteName is sufficient).
_suite_marker() {
  local suiteName="$1"
  printf 'suite-fingerprint:%s' "$suiteName"
}

# Internal: render a markdown table of cases with a given state.
_case_table() {
  local summary="$1"
  local state="$2"
  jq -r --arg st "$state" '
    .cases // []
    | map(select(.state == $st))
    | if length == 0 then empty else
        (["| caseId | state | pass | fail |", "|---|---|---|---|"]
         + (map("| \(.caseId // .id // "?") | \(.state) | \(.passCount // 0) | \(.failCount // 0) |")))
        | .[]
      end
  ' "$summary" 2>/dev/null || true
}

# Internal: short top-N list for comments.
_case_list_brief() {
  local summary="$1"
  local state="$2"
  local n="${3:-10}"
  jq -r --arg st "$state" --argjson n "$n" '
    .cases // []
    | map(select(.state == $st))
    | .[0:$n]
    | map("- `\(.caseId // .id // "?")` \(.state) pass=\(.passCount // 0) fail=\(.failCount // 0)")
    | .[]
  ' "$summary" 2>/dev/null || true
}

# Internal: find open issue number matching label + suite fingerprint, or empty.
_find_open_issue() {
  local label="$1"
  local suiteName="$2"
  local marker
  marker=$(_suite_marker "$suiteName")
  local repo="${GITHUB_REPOSITORY:-}"
  local args=(issue list --state open --label "$label" --json number,body --limit 50)
  if [ -n "$repo" ]; then
    args+=(--repo "$repo")
  fi
  local json
  if ! json=$(gh "${args[@]}" 2>/dev/null); then
    echo ""
    return 0
  fi
  echo "$json" | jq -r --arg m "$marker" '
    .[] | select((.body // "") | contains($m)) | .number
  ' 2>/dev/null | head -n1 || true
}

# act <class> <suiteName> <summary.json> <context-json>
# Issue lifecycle for drift/infra/healthy. flaky is a safe no-op.
act() {
  local class="${1:-}"
  local suiteName="${2:-suite}"
  local summary="${3:-}"
  local context="${4:-{}}"
  local repo="${GITHUB_REPOSITORY:-}"
  local repo_args=()
  if [ -n "$repo" ]; then
    repo_args=(--repo "$repo")
  fi
  local marker
  marker=$(_suite_marker "$suiteName")
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)

  case "$class" in
    flaky)
      # Workflow handles ::warning::; act is a no-op.
      return 0
      ;;
    healthy)
      # Close open drift/infra issues for this suite with a single recovery comment.
      local label num
      for label in desurf-drift desurf-infra; do
        num=$(_find_open_issue "$label" "$suiteName")
        if [ -n "$num" ]; then
          gh issue close "$num" "${repo_args[@]}" \
            --comment "closed by drift-watch: recovered at ${ts} (context: ${context})" 2>/dev/null || true
        fi
      done
      return 0
      ;;
    drift|infra)
      local label title body table brief
      if [ "$class" = "drift" ]; then
        label="desurf-drift"
        title="🔴 [drift-watch] drift in ${suiteName}"
        table=$(_case_table "$summary" "REGRESSION")
        brief=$(_case_list_brief "$summary" "REGRESSION" 10)
      else
        label="desurf-infra"
        title="🟠 [drift-watch] infra errors in ${suiteName}"
        table=$(_case_table "$summary" "ERROR")
        brief=$(_case_list_brief "$summary" "ERROR" 10)
      fi
      body=$(cat <<BODY
<!-- ${marker} -->
## Drift-watch report

**Class:** \`${class}\`
**Suite:** \`${suiteName}\`
**Timestamp:** ${ts}

### Context
\`\`\`json
${context}
\`\`\`

### Cases
${table:-_(none)_}

${brief:+### Brief
${brief}}

### Remediation
Re-baseline via the B1 loop: \`desurf record\` → \`desurf diff\` → \`desurf accept --yes\`.
See [docs/drift-watch.md](docs/drift-watch.md).
BODY
)
      local existing
      existing=$(_find_open_issue "$label" "$suiteName")
      if [ -n "$existing" ]; then
        local comment
        comment=$(cat <<CMT
### Update at ${ts}

**Class:** \`${class}\`

${brief:-_(no matching cases)_}

Context:
\`\`\`json
${context}
\`\`\`
CMT
)
        if ! gh issue comment "$existing" "${repo_args[@]}" --body "$comment"; then
          echo "error: failed to comment on issue #${existing}" >&2
          return 1
        fi
      else
        if ! gh issue create "${repo_args[@]}" --title "$title" --label "$label" --body "$body"; then
          echo "error: failed to create ${label} issue for ${suiteName}" >&2
          return 1
        fi
      fi
      return 0
      ;;
    *)
      echo "act: unknown class '${class}' (no-op)" >&2
      return 0
      ;;
  esac
}
