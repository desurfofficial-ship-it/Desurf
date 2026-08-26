# Desurf

**Offline-first CLI for testing AI prompt behavior and detecting regressions.**

Version **0.1.2**

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
desurf --version   # 0.1.2
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
- `desurf init <directory>` — create a minimal runnable suite (refuses overwrite)
- `desurf record --suite <path> --provider openrouter [--force] [--case id]` — capture live outputs

Exit codes: **0** PASS · **1** REGRESSION/FLAKY · **2** ERROR (configuration / tooling / invalid contract)

## Assertions

| Type | Behavior |
|------|----------|
| `required` | Literal substring must appear. **Default case-sensitive.** Opt out with `"caseSensitive": false`. |
| `forbidden` | Literal substring must **not** appear. **Default case-insensitive** (safer for AI disclaimers). Opt into exact match with `"caseSensitive": true`. |
| `regex` | JavaScript `RegExp`. Invalid patterns are a **configuration error** (exit 2), not a regression. |
| `json_schema` | Minimal Desurf dialect only: `type` (`"object"`), `required`, `properties.*.const`, `properties.*.enum`. Unsupported keywords (e.g. `minLength`, `items`, `additionalProperties`) are **rejected at load time** (exit 2). |

Unknown assertion fields are rejected (exit 2). Empty suites and empty assertion lists are configuration errors (exit 2). Duplicate case IDs are rejected (exit 2).

## Docs (shipped with the package)

After install, documentation is available under `node_modules/@desurfofficial-ship-it/desurf/docs/`:

- `docs/cli-contract.md`
- `docs/test-case-schema.md`
- `docs/architecture.md`

## License

MIT
