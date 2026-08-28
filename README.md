# Desurf

**Offline-first CLI for testing AI prompt behavior and detecting regressions.**

Version **0.1.3**

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
desurf --version   # 0.1.3
```

## How offline testing works

Offline mode **evaluates saved output fixtures**. It does **not** execute the prompt against a live model.

```
prompt + input
      ↓
record / live provider   (optional — captures outputs)
      ↓
saved output fixture
      ↓
desurf test (offline)    ← contract evaluation only
```

Typical workflow:

1. Write prompt, input, and assertions (`desurf init` scaffolds this).
2. Capture a known-good model response with `desurf record` (or write the fixture by hand).
3. Run `desurf test --suite <path>` offline — deterministic, CI-friendly, no API keys.

## Commands

- `desurf test --suite <path> [--verbose] [--json] [--repeat N] [--provider offline|openrouter]`
- `desurf init <directory>` — scaffold a runnable structured-output example suite (refuses overwrite)
- `desurf record --suite <path> --provider openrouter [--force] [--case id]` — capture live outputs

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
