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
desurf test --suite <path> [--case <id>] [--repeat <n>] [--provider <name>] [--model <id>]
```

| Option | Meaning |
|--------|---------|
| `--suite <path>` | Path to suite directory (or suite.json) |
| `--case <id>` | Run only the named test case |
| `--repeat <n>` | Execute each case N times (default 1) |
| `--provider <name>` | `offline` (default) or `openrouter` |
| `--model <id>` | Model id for live providers (default: `openai/gpt-4o-mini`) |

### Exit codes (public API)

| Exit code | Meaning |
|-----------|---------|
| **0** | All tests **PASS** |
| **1** | Quality gate failure (**FLAKY** or **REGRESSION**) |
| **2** | Execution / configuration / provider / tool error |

Do not change exit-code meanings without a major version bump.

### Offline (default)

```bash
desurf test --suite fixtures/basic --repeat 3
```

Uses saved outputs on disk. No API key. Deterministic — this is what CI runs.

### Live OpenRouter

```bash
export OPENROUTER_API_KEY=...   # never commit this
desurf test --suite path/to/suite --provider openrouter --model openai/gpt-4o-mini
```

- Requires a real `OPENROUTER_API_KEY` in the environment.
- Live calls are optional; unit tests mock HTTP and do not need a key.
- CI remains offline and deterministic (no live provider in GitHub Actions).

## Reliability states

| State | Meaning |
|-------|---------|
| PASS | All N executions passed assertions |
| FLAKY | Mix of pass and fail, no execution errors |
| REGRESSION | All N executions completed but failed assertions |
| ERROR | One or more executions could not be evaluated |

## Examples

- `fixtures/basic` — minimal offline PASS case (CI gate)
- `examples/support-agent` — good + regressed offline cases; FLAKY shown in tests

## CI

`.github/workflows/ci.yml` — typecheck, unit tests, offline gate on every push/PR to `main`. No live API keys.

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
