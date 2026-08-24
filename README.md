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
| **0** | **PASS** — contract evaluated and held |
| **1** | **FLAKY** or **REGRESSION** — contract evaluated but did not hold |
| **2** | **ERROR** — provider / configuration / tool failure (could not evaluate) |

Do not change exit-code meanings without a major version bump.

## Offline vs live testing

Desurf separates **deterministic contract tests** from **optional live-model runs**.

### Offline contract tests (default, required CI)

`fixtures/basic` and `examples/support-agent` are **behavioral-contract suites**. They use saved outputs on disk (`SavedOutputAdapter`). No API key. Results are deterministic.

```bash
desurf test --suite fixtures/basic --repeat 3
```

Required CI (`.github/workflows/ci.yml`) runs offline only. It does **not** call live models and does **not** need `OPENROUTER_API_KEY`.

### Optional live provider runs

Live providers are opt-in and are **never** a merge gate.

```bash
export OPENROUTER_API_KEY=...   # never commit this
desurf test \
  --suite fixtures/basic \
  --case support-classifier-good \
  --provider openrouter \
  --model openai/gpt-4o-mini \
  --repeat 1
```

Important:

- Running an offline **contract** suite against a live model does **not** guarantee **PASS**.
- Live model output is inherently model- and provider-dependent; it is **not** assumed deterministic.
- **Exit 1 (REGRESSION/FLAKY)** on a live run means the provider returned usable output and Desurf evaluated it, but the output **violated the contract**. That is **not** automatically an OpenRouter integration failure.
- **Exit 2** means evaluation could not complete (missing/invalid key, network/HTTP error, timeout, empty response, bad config).
- Live runs are useful to see how a **real model** behaves against an explicit contract; treat results as contract evidence for that model/settings, not as a substitute for offline CI.

## Reliability states

| State | Meaning |
|-------|---------|
| PASS | All N executions passed assertions |
| FLAKY | Mix of pass and fail, no execution errors |
| REGRESSION | All N executions completed but failed assertions |
| ERROR | One or more executions could not be evaluated |

## Examples

- `fixtures/basic` — minimal offline contract suite (CI gate)
- `examples/support-agent` — good + regressed offline contract cases; FLAKY shown in unit tests

## CI

`.github/workflows/ci.yml` — typecheck, unit tests, offline gate on every push/PR to `main`. No live API keys. Live OpenRouter is optional/manual only.

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
