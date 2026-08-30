# Desurf

**Offline-first CLI for testing AI prompt behavior and detecting regressions.**

Version **0.3.0**

Desurf lets developers define expected AI behavior as testable contracts and detect behavioral regressions when model outputs change.

## Install

```bash
npm install -g @desurfofficial-ship-it/desurf
```

Or without a global install:

```bash
npx @desurfofficial-ship-it/desurf --version
```

The published package name is **`@desurfofficial-ship-it/desurf`**. The CLI binary is still `desurf`.

## Quickstart

```bash
desurf init ./my-suite
desurf test --suite ./my-suite
desurf --version   # 0.3.0
```

`desurf init` scaffolds a **sealed** example suite (output + `.desurf` provenance) so the first `desurf test` is fully offline and protected against prompt/input drift.

## Cassette states

Every test case has an output cassette. That cassette is in one of three states:

| State | What exists on disk | Assertions | Prompt/input drift detection |
|-------|---------------------|------------|------------------------------|
| **UNSEALED** | output only (no `.desurf`) | run normally | **not** detected (legacy-compatible) |
| **SEALED** | output + `.desurf` from `desurf seal` | run normally | detected → **ERROR (exit 2)** |
| **RECORDED** | output + `.desurf` from `desurf record` | run normally | detected → **ERROR (exit 2)** |

- **UNSEALED** — useful for quick experiments or v0.2/v0.3 suites that never adopted provenance. Safe to keep; you simply will not catch stale fixtures.
- **SEALED** — you already have a trusted response file (from a prior model run, a hand-authored golden file, or a teammate). `desurf seal` fingerprints the current input and prompt **locally**. No API key, no network.
- **RECORDED** — you want a fresh capture from a live provider. `desurf record` writes the output and the provenance metadata together.

`seal` and `record` produce the same `.desurf` shape. The difference is only how the output was obtained.

## Recommended workflow

**You already have a response file:**

```bash
desurf seal --suite ./my-suite
desurf test --suite ./my-suite
```

**You want a live model capture:**

```bash
export OPENROUTER_API_KEY=...
desurf record --suite ./my-suite --provider openrouter
desurf test --suite ./my-suite
```

**After changing a prompt or input** (sealed/recorded suite):

1. `desurf test` fails with **ERROR (exit 2)** — prompt/input no longer matches the cassette fingerprints.
2. Choose an explicit remediation (Desurf never auto-repairs):
   - **Keep the existing output** and re-fingerprint current prompt/input (offline, no API key):
     `desurf seal --suite ./my-suite --force`
   - **Obtain a new provider output** and provenance:
     `desurf record --suite ./my-suite --provider openrouter --force`
   - Or restore the previous prompt/input files.

### Why exit 2 vs exit 1?

| Exit | Meaning | Typical cause |
|------|---------|----------------|
| **0** | PASS | Contract held |
| **1** | REGRESSION / FLAKY | Output was evaluated; assertions failed (behavior changed) |
| **2** | ERROR | Could not trust or evaluate the cassette (stale provenance, missing files, bad config, provider failure) |

Stale prompt/input is **not** a regression: the saved output no longer corresponds to the files under test, so Desurf refuses to treat the result as a contract verdict.

## How offline testing works

Offline mode **evaluates saved output cassettes**. It does **not** execute the prompt against a live model.

```
prompt + input
      ↓
[desurf record (live provider)]  OR  [existing response + desurf seal (offline)]
      ↓
fingerprinted cassette (.desurf sidecar with SHA-256 hashes)
      ↓
desurf test (offline) ← evaluates behavioral contract deterministically
```

### Establishing Cassette Provenance

- **`desurf record`**: Obtains a response from a supported live provider (e.g. OpenRouter) and creates the fingerprinted `.desurf` metadata in the same step.
- **`desurf seal`**: Takes an existing output file on disk and writes `.desurf` from the current input and prompt files. Purely offline (no API keys, no network).
- **`.desurf` sidecar**: Stores `inputSha256` / `promptSha256` next to each cassette. If those files change without updating the cassette, `desurf test` fails with **ERROR (exit 2)**.
- **Legacy / unsealed suites**: Missing `.desurf` files remain supported. Assertions still run; stale-fixture protection is simply off until you seal.

`desurf seal` safety rules:

- Requires a non-empty output file per case (missing or empty → error).
- Does **not** overwrite existing `.desurf` metadata unless `--force` is set.
- Supports suite directory or direct `suite.json` path, and `--case <id>` to seal one case.

## Commands

- `desurf test --suite <path> [--verbose] [--json] [--repeat N] [--provider offline|openrouter]`
- `desurf init <directory>` — scaffold a runnable structured-output example suite (refuses overwrite)
- `desurf record --suite <path> --provider openrouter [--force] [--case id]` — capture live provider outputs
- `desurf seal --suite <path> [--force] [--case id]` — establish offline provenance from existing output files

Exit codes: **0** PASS · **1** REGRESSION/FLAKY · **2** ERROR

## Assertions

`required`, `forbidden` (optional `caseSensitive: false`), `regex`, `json_schema` (minimal: `type`, `required`, `properties.*.const`, `properties.*.enum` against **parsed** JSON).

Unknown assertion fields are rejected (exit 2).

## CI (GitHub Actions)

Desurf is designed for offline CI gating. Exit codes fail the job automatically:

| Exit | Meaning | CI result |
|------|---------|-----------|
| 0 | PASS | green |
| 1 | REGRESSION / FLAKY | red |
| 2 | ERROR (config, missing files, stale fixture, …) | red |

**This repository** builds the CLI from source and runs the offline fixture (no API keys):

```bash
npm install
npm run build
node dist/cli.js test --suite fixtures/basic
```

**Your application repository** can copy [`examples/github-actions/desurf.yml`](examples/github-actions/desurf.yml) and point `--suite` at your committed suite:

```yaml
- run: npx --yes @desurfofficial-ship-it/desurf test --suite ./desurf-suite
```

Never set `OPENROUTER_API_KEY` in the merge gate. Live providers are optional and manual only.

## Docs

See `docs/cli-contract.md`, `docs/test-case-schema.md`, `docs/architecture.md`.

## License

MIT
