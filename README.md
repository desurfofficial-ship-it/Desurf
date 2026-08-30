# Desurf

**Offline-first CLI for testing AI prompt behavior and detecting regressions.**

Version **0.4.0**

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
desurf --version   # 0.4.0
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
# OpenRouter
export OPENROUTER_API_KEY=...
desurf record --suite ./my-suite --provider openrouter

# OpenAI
export OPENAI_API_KEY=...
desurf record --suite ./my-suite --provider openai --model gpt-4o-mini

# Anthropic
export ANTHROPIC_API_KEY=...
desurf record --suite ./my-suite --provider anthropic --model claude-3-5-haiku-20241022

# Google Gemini
export GEMINI_API_KEY=...
desurf record --suite ./my-suite --provider gemini --model gemini-2.0-flash

# Deterministic offline gate
desurf test --suite ./my-suite
```

**After changing a prompt or input** (sealed/recorded suite):

1. `desurf test` fails with **ERROR (exit 2)** — prompt/input no longer matches the cassette fingerprints.
2. Choose an explicit remediation (Desurf never auto-repairs):
   - **Keep the existing output** and re-fingerprint current prompt/input (offline, no API key):
     `desurf seal --suite ./my-suite --force`
   - **Obtain a new provider output** and provenance:
     `desurf record --suite ./my-suite --provider <name> --force`
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

- `desurf test --suite <path> [--verbose] [--json] [--repeat N] [--provider offline|openrouter|openai|anthropic|gemini] [--model id]`
- `desurf init <directory>` — scaffold a runnable structured-output example suite (refuses overwrite)
- `desurf record --suite <path> --provider <name> [--model id] [--force] [--case id]` — capture live provider outputs
- `desurf seal --suite <path> [--force] [--case id]` — establish offline provenance from existing output files
- `desurf inspect --suite <path> [--json] [--case id]` — inspect cassette provenance status (read-only)

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

### Reusable Action (recommended for app repos)

```yaml
- uses: actions/checkout@v4
- uses: desurfofficial-ship-it/Desurf@main   # or a full commit SHA; do not invent tags
  with:
    suite: ./desurf-suite
    version: "0.4.0"   # npm package pin (never "latest")
```

**Pins are independent:**
- **Action ref** (`uses: ...@ref`) selects the Action definition (composite steps in this repository). Prefer a full **commit SHA** for production supply-chain pinning. `@main` tracks development and can change at any time. A stable **`v0.4` Action tag** is planned for the v0.4 release and is **not** created until that release is cut—do not invent tags that do not exist yet.
- **`version`** selects the published **`@desurfofficial-ship-it/desurf`** npm package the Action installs (default `0.4.0` until a newer package is published). It does **not** run the Action checkout’s source tree.

**Network vs offline:** npm install needs network once. The Desurf **test** gate is offline (no live provider, no `OPENROUTER_API_KEY`, no record).

**Stale cassettes:** sealed/recorded prompt or input drift → exit **2**. Refresh offline with `desurf seal --force` (keeps output) or re-capture with `desurf record --force`.

- Propagates exit codes **0 / 1 / 2**.
- Installs into a temporary directory (does not modify consumer `package.json` / lockfile / `node_modules`).
- See [`action.yml`](action.yml) and [`examples/github-actions/desurf.yml`](examples/github-actions/desurf.yml).

### This repository (source build)

```bash
npm install
npm run build
node dist/cli.js test --suite fixtures/basic
```

**Alternative (inline CLI):** copy [`examples/github-actions/desurf.yml`](examples/github-actions/desurf.yml) or run:

```yaml
- run: npx --yes @desurfofficial-ship-it/desurf test --suite ./desurf-suite
```

Never set `OPENROUTER_API_KEY` in the merge gate. Live providers are optional and manual only.

## Docs

See `docs/cli-contract.md`, `docs/test-case-schema.md`, `docs/architecture.md`.

## License

MIT
