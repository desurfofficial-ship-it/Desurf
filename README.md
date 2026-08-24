# Desurf

**AI outputs surf on the surface. Desurf checks what is underneath — the behavioral contract.**

Desurf is an offline-first CLI for testing AI prompt behavior and detecting regressions before they reach users.

## Stage 1 status

Minimal offline test runner:

- Load a suite + saved model output
- Evaluate behavioral assertions (required, forbidden, regex, json_schema)
- Report PASS / FAIL
- Deterministic exit codes

No live model providers. No `--repeat`. No CI yet.

## Quick start

```bash
npm install
npx tsx src/cli.ts test --suite fixtures/basic
```

Expected:

```
Desurf

✓ support-classifier-good
  PASS

Results: 1 passed, 0 failed, 0 error
```

Exit code `0`.

## Commands

```bash
desurf test --suite <path> [--case <id>]
```

| Exit code | Meaning                                      |
|-----------|----------------------------------------------|
| 0         | All tests PASS                               |
| 1         | One or more assertion failures               |
| 2         | Execution / configuration / tool error       |

## Project docs

- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md) — full product vision and milestones
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) — how to work on this codebase
- [docs/architecture.md](./docs/architecture.md)
- [docs/cli-contract.md](./docs/cli-contract.md)
- [docs/test-case-schema.md](./docs/test-case-schema.md)

## License

MIT
