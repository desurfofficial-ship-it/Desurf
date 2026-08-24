# Desurf

**AI outputs surf on the surface. Desurf checks what is underneath — the behavioral contract.**

Desurf is an offline-first CLI for testing AI prompt behavior and detecting regressions before they reach users.

## Stage 2 status

Reliability classification with repeated execution:

- `--repeat N` runs each case N times
- States: **PASS** / **FLAKY** / **REGRESSION** / **ERROR**
- Deterministic exit codes for CI

Still offline-first. No live model providers. No CI workflow yet (Stage 3).

## Quick start

```bash
npm install
npx tsx src/cli.ts test --suite fixtures/basic
npx tsx src/cli.ts test --suite fixtures/basic --repeat 3
```

Expected (single run):

```
Desurf

✓ support-classifier-good
  PASS

Results: 1 passed, 0 flaky, 0 regression, 0 error
```

With `--repeat 3` (same offline fixture → all pass):

```
✓ support-classifier-good
  PASS
  3/3 passed

Results: 1 passed, 0 flaky, 0 regression, 0 error
```

## Commands

```bash
desurf test --suite <path> [--case <id>] [--repeat <n>]
```

| Exit code | Meaning                                      |
|-----------|----------------------------------------------|
| 0         | All tests **PASS**                           |
| 1         | Quality gate failure (**FLAKY** or **REGRESSION**) |
| 2         | Execution / configuration / tool error       |

## Reliability states

| State        | Meaning                                              |
|--------------|------------------------------------------------------|
| PASS         | All N executions passed assertions                   |
| FLAKY        | Mix of pass and fail, no execution errors            |
| REGRESSION   | All N executions completed but failed assertions     |
| ERROR        | One or more executions could not be evaluated        |

## Project docs

- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/cli-contract.md](./docs/cli-contract.md)
- [docs/test-case-schema.md](./docs/test-case-schema.md)

## License

MIT
