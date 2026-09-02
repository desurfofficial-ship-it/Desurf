# T16 golden-master evidence — v0.9.0 vs published 0.8.0

**Method:** `npm pack @desurfofficial-ship-it/desurf@0.8.0` → extract → `node package/dist/cli.js`.
Local: `node dist/cli.js` after build at package version 0.9.0. Both run from repo root against the same `fixtures/`.

**Versions observed:** published CLI `--version` → `0.8.0`; local → `0.9.0`.

## Surface matrix

| Surface | Exit codes (0.8.0 / 0.9.0) | Normalized output | Classification |
|---------|----------------------------|-------------------|----------------|
| offline test PASS (`fixtures/basic`) | 0 / 0 | IDENTICAL | intended (version strings only when unnormalized) |
| offline test REGRESSION (`forbidden: billing`) | 1 / 1 | IDENTICAL | intended |
| `test --json` summary keys/shape | 0 / 0 | keys `suite,status,counts,cases`; status PASS | intended (identical shape) |
| `diff --suite fixtures/basic` | 0 / 0 | IDENTICAL | intended |
| `inspect --suite fixtures/basic` | 0 / 0 | IDENTICAL | intended |
| `seal --force` (temp suite copy) | 0 / 0 | IDENTICAL | intended |
| max_diff_lines exact-count message (H3) | n/a offline trivial-pass without baseline | see M1/H3 | **intended** — H3 changed exceed wording when baseline exists (`≥N` / body-wide truncated regex removed; exact `countChangedLinesBetween`) |

## Diffs

### Version strings (all surfaces when not normalized)

Expected: `0.8.0` vs `0.9.0` in any version-bearing lines. Not a behavior change.

### Unintended diffs

**None observed** on inspect, seal, cassette shapes, offline PASS/REGRESSION text (modulo version), or `--json` keys/shapes.

### H3 budget message (intentional)

When a baseline reference exists and budget is exceeded, v0.9.0 reports exact counts and, if the display diff is capped, appends `(budget computed on full texts; diff display truncated at 2000 lines)` instead of the v0.8.0 `≥N` / body-wide truncation heuristic. Covered by `test/m1-budget.test.ts` (T10–T12). Offline suites without a retained baseline still trivial-pass (unchanged).

## Verdict

T16 **PASS** — no unintended golden-master deltas vs published 0.8.0 for the exercised offline surfaces.
