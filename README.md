# Desurf

**AI outputs surf on the surface. Desurf checks what is underneath — the behavioral contract.**

Desurf is an offline-first CLI for testing AI prompt behavior and detecting regressions before they reach users.

## Install

```bash
# From source (development)
git clone https://github.com/desurfofficial-ship-it/Desurf.git
cd Desurf
npm install
npm run build

# Run without global install
node dist/cli.js test --suite fixtures/basic

# Or link globally for the `desurf` command
npm link
desurf test --suite fixtures/basic
```

When published to npm:

```bash
npm install -g desurf
desurf test --suite path/to/your-suite
```

## Quick start (development)

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

Exit codes are part of the public API. Do not change them without a major version bump.

## Reliability states

| State        | Meaning                                              |
|--------------|------------------------------------------------------|
| PASS         | All N executions passed assertions                   |
| FLAKY        | Mix of pass and fail, no execution errors            |
| REGRESSION   | All N executions completed but failed assertions     |
| ERROR        | One or more executions could not be evaluated        |

## Examples

- `fixtures/basic` — minimal offline PASS case (CI gate)
- `examples/support-agent` — good + regressed offline cases; FLAKY shown in tests

## CI

`.github/workflows/ci.yml` — typecheck, unit tests, offline gate on every push/PR to `main`.

## Packaging

See [docs/publishing.md](./docs/publishing.md) for versioning and publish steps.

Version **0.1.0** · License **MIT**

## Project docs

- [PROJECT_BLUEPRINT.md](./PROJECT_BLUEPRINT.md)
- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/cli-contract.md](./docs/cli-contract.md)
- [docs/test-case-schema.md](./docs/test-case-schema.md)
- [docs/publishing.md](./docs/publishing.md)
- [examples/support-agent/README.md](./examples/support-agent/README.md)
