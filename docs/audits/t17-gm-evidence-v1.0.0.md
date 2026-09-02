# T17 golden-master evidence — v1.0.0 vs published 0.9.0

**Method:** `npm pack @desurfofficial-ship-it/desurf@0.9.0` → extract → `node package/dist/cli.js`.
Local: `node dist/cli.js` after build at package version **1.0.0**. Both from repo root against equivalent fixtures (throwaway copies where noted).

**Versions observed:** published CLI `--version` → `0.9.0`; local → `1.0.0`.

## Surface matrix

| Surface | Exit codes (0.9.0 / 1.0.0) | Normalized output | Classification |
|---------|----------------------------|-------------------|----------------|
| offline test PASS (`fixtures/basic`) | 0 / 0 | IDENTICAL | intended |
| offline test REGRESSION (`forbidden: billing`) | 1 / 1 | IDENTICAL | intended |
| `test --json` summary keys/shape | 0 / 0 | IDENTICAL keys | intended |
| `diff --suite fixtures/basic` | 2 / 2 | IDENTICAL | intended (no pending snapshot) |
| `inspect --suite fixtures/basic` | 0 / 0 | IDENTICAL | intended |
| `seal --force` (temp suite copy) | 0 / 0 | IDENTICAL | intended |
| H3 max_diff_lines exact-count (unit) | fail msg exact count | same H3 semantics as 0.9.0 | intended (no change vs 0.9.0) |
| `record` missing `--provider` | 2 / 2 | IDENTICAL | intended |
| `record --provider openrouter --fill-gaps` | 0 / 0 | IDENTICAL (modulo abs paths) | intended |
| `record … --fill-gaps --json` | 0 / 0 | IDENTICAL JSON shape | intended |
| `accept --all --yes` (nothing pending) | 1 / 1 | IDENTICAL `nothing to accept` | intended |
| `accept … --json` (nothing pending) | 1 / 1 | IDENTICAL keys | intended |
| `accept` pending, missing `--yes` | 2 / 2 | IDENTICAL `refusing to accept without --yes…` | intended |

## Diffs

### Version strings
Expected: `0.9.0` vs `1.0.0` when not normalized. Not a behavior change.

### Unintended diffs
**None observed.**

## Verdict

T17 **PASS** — zero unintended golden-master deltas vs published 0.9.0 across the required matrix.
