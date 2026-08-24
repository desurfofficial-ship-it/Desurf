# Desurf

**AI outputs surf on the surface. Desurf checks what is underneath — the behavioral contract.**

Desurf is an offline-first CLI for testing AI prompt behavior and detecting regressions before they reach users.

## Stage 3 status

Regression gate in CI:

- GitHub Actions runs offline only (no API keys)
- Typecheck → unit tests → `desurf test --suite fixtures/basic --repeat 3`
- Exit codes block bad changes: 0 = PASS, 1 = FLAKY/REGRESSION, 2 = ERROR

## Quick start

```bash
npm install
npx tsx src/cli.ts test --suite fixtures/basic
npx tsx src/cli.ts test --suite fixtures/basic --repeat 3
npm run test:offline   # same as the CI gate
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

## CI

Workflow: `.github/workflows/ci.yml`

Runs on every push and pull request to `main`. Offline only.

## Project docs

- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/cli-contract.md](./docs/cli-contract.md)
- [docs/test-case-schema.md](./docs/test-case-schema.md)

## License

MIT
