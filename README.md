# Desurf

**AI outputs surf on the surface. Desurf checks what is underneath — the behavioral contract.**

Desurf is an offline-first CLI for testing AI prompt behavior and detecting regressions before they reach users.

## Stage 4 status

Public example: `examples/support-agent/`

- **good** → PASS (offline)
- **regressed** → REGRESSION (offline)
- **flaky** → demonstrated with a deterministic mock provider in tests

CI regression gate remains on `fixtures/basic` (offline-only, must stay green).

## Quick start

```bash
npm install
npx tsx src/cli.ts test --suite fixtures/basic --repeat 3
npx tsx src/cli.ts test --suite examples/support-agent --case support-classifier-good
npm test
npm run test:offline
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

Workflow: `.github/workflows/ci.yml` — offline gate on every push/PR to `main`.

## Project docs

- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/cli-contract.md](./docs/cli-contract.md)
- [docs/test-case-schema.md](./docs/test-case-schema.md)
- [examples/support-agent/README.md](./examples/support-agent/README.md)

## License

MIT
