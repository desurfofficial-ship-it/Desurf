# Desurf

**Offline-first CLI for testing AI prompt behavior and detecting regressions.**

Version **0.1.1**

## Install

```bash
npm install -g desurf
```

## Quickstart

```bash
desurf init ./my-suite
desurf test --suite ./my-suite
desurf --version   # 0.1.1
```

## Commands

- `desurf test --suite <path> [--verbose] [--json] [--repeat N] [--provider offline|openrouter]`
- `desurf init <directory>` — create a minimal runnable suite (refuses overwrite)
- `desurf record --suite <path> --provider openrouter [--force] [--case id]` — capture live outputs

Exit codes: **0** PASS · **1** REGRESSION/FLAKY · **2** ERROR

## Assertions

`required`, `forbidden` (optional `caseSensitive: false`), `regex`, `json_schema` (minimal: `type`, `required`, `properties.*.const`, `properties.*.enum` against **parsed** JSON).

Unknown assertion fields are rejected (exit 2).

## Docs

See `docs/cli-contract.md`, `docs/test-case-schema.md`, `docs/architecture.md`.

## License

MIT
