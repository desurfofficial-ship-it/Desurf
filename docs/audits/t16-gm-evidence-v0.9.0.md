# T16 golden-master evidence — v0.9.0 vs published 0.8.0

**Method:** `npm pack @desurfofficial-ship-it/desurf@0.8.0` → extract → `node package/dist/cli.js`.
Local: `node dist/cli.js` after build at package version 0.9.0. Both run from repo root against the same `fixtures/` (or throwaway copies as noted).

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
| `record --help` | 0 / 0 | IDENTICAL | intended |
| `record` missing `--provider` | 2 / 2 | IDENTICAL stderr `Missing required option: --provider <name>` + help on stdout | intended |
| `record … --json` missing `--provider` | 2 / 2 | Same help-on-stdout / stderr message (no JSON error object — both versions) | intended |
| `record --provider openrouter --fill-gaps` (output already exists) | 0 / 0 | IDENTICAL (modulo absolute paths in message) | intended — skips without network |
| `record --provider openrouter --fill-gaps --json` | 0 / 0 | IDENTICAL JSON keys: `command,suite,provider,model,exitCode,summary,results[]` | intended |
| `accept --suite fixtures/basic --all --yes` (no pending) | 1 / 1 | IDENTICAL text `nothing to accept` | intended |
| `accept … --all --yes --json` (no pending) | 1 / 1 | IDENTICAL keys `command,suite,accepted,nothingToAccept,errors,exitCode` | intended |
| `accept` with pending entry, missing `--yes` | 2 / 2 | IDENTICAL stderr `refusing to accept without --yes in non-interactive mode` | intended |
| `accept --json` with pending, missing `--yes` | 2 / 2 | IDENTICAL (message on stderr; no alternate JSON body) | intended |

## record / accept procedure notes

### record (offline-deterministic)

1. Missing provider: `node <cli> record --suite fixtures/basic` → exit 2.
2. Existing baseline without live call: `node <cli> record --suite fixtures/basic --provider openrouter --fill-gaps` → exit 0, message contains `Output already exists (fill-gaps skips existing)` (absolute path differs by CWD only).
3. Same with `--json` → structured summary; paths in `message` normalized for comparison.

No live provider or network was used.

### accept (hand-crafted pending history)

Throwaway copy of `fixtures/basic`:

1. `cp -a fixtures/basic/. $SUITE/`
2. Write `.desurf-history/support-classifier-good/20260902T000000000Z-record.json` with `schemaVersion: 1`, `kind: "record"`, `output` + matching `outputSha256` via `sha256(text.replace(/\r\n/g, "\n"))`, `verdictAtCapture: "drift"`, `acceptedAt` null in index.
3. Write sibling `index.json` listing that file with `acceptedAt: null`.
4. `node <cli> accept --suite $SUITE --case support-classifier-good` → exit 2 without `--yes`.
5. Confirm with `--yes` on 0.9.0 only (smoke that pending is real) → exit 0; not a golden-master delta claim.

## Diffs

### Version strings (all surfaces when not normalized)

Expected: `0.8.0` vs `0.9.0` in any version-bearing lines. Not a behavior change.

### Unintended diffs

**None observed** on inspect, seal, cassette shapes, offline PASS/REGRESSION text (modulo version), `--json` keys/shapes, **record** config/fill-gaps paths, or **accept** nothing-to-accept / missing-`--yes` paths.

### H3 budget message (intentional)

When a baseline reference exists and budget is exceeded, v0.9.0 reports exact counts and, if the display diff is capped, appends `(budget computed on full texts; diff display truncated at 2000 lines)` instead of the v0.8.0 `≥N` / body-wide truncation heuristic. Covered by `test/m1-budget.test.ts` (T10–T12). Offline suites without a retained baseline still trivial-pass (unchanged).

## Verdict

T16 **PASS** — no unintended golden-master deltas vs published 0.8.0 for the exercised offline surfaces, including **record** and **accept**.
