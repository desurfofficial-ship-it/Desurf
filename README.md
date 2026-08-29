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

To protect against stale fixtures (e.g. editing a prompt but testing against old outputs), Desurf uses `.desurf` sidecar metadata containing SHA-256 hashes of the prompt and input:

- **`desurf record`**: Obtains a response from a supported live provider (e.g. OpenRouter) and automatically creates the fingerprinted `.desurf` metadata.
- **`desurf seal`**: Takes an existing output file on disk and establishes offline provenance by generating `.desurf` metadata from the current input and prompt files (no API keys, no network calls).
- **`.desurf` sidecar**: Stores input/prompt hashes next to each cassette. If prompt or input files change without updating the cassette, `desurf test` fails with **ERROR (exit 2)**.
- **Legacy suites**: Missing `.desurf` files remain supported for backwards compatibility, but do not provide stale-fixture protection.

Typical workflow:

1. Define prompt, input, and assertions (`desurf init` scaffolds a runnable suite).
2. Capture or seal a cassette:
   - Use `desurf record --provider openrouter` with a live model, or
   - Place an existing response file and run `desurf seal --suite <path>` offline.
3. Run `desurf test --suite <path>` in CI/local — deterministic, zero API cost, exit codes 0 / 1 / 2.

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
