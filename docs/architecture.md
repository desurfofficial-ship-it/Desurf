# Architecture

Desurf is a small offline-first CLI for prompt regression testing.

## Layers

1. **CLI** (`src/cli.ts`) — arg parsing, help, version, command dispatch (`test` / `init` / `record` / `seal`), exit codes. No evaluation logic.
2. **Loader** (`src/offline.ts`) — reads `suite.json`, validates assertion fields, resolves paths.
3. **Init** (`src/init.ts`) — scaffolds a runnable structured-output example suite.
4. **Record** (`src/record.ts`) — live provider → write output files and `.desurf` metadata (no assertion evaluation).
5. **Seal** (`src/seal.ts`) — offline provenance → write `.desurf` metadata for existing output files without live provider calls.
6. **Runner** (`src/runner.ts`) — orchestrates load → provider → engine → reliability summary.
7. **Engine** (`src/engine.ts`) — pure: TestCase + ModelOutput → TestResult.
8. **Assertions** (`src/assertions.ts`) — pure evaluation of required / forbidden / regex / json_schema.
9. **Providers** (`src/provider.ts`, `src/openrouter.ts`, `src/create-provider.ts`) — `ModelAdapter` interface; offline saved-output vs OpenRouter.
10. **Reliability** (`src/repeat.ts`) — PASS / FLAKY / REGRESSION / ERROR from N executions.
11. **Fingerprint** (`src/fingerprint.ts`) — SHA-256 sidecar calculation and stale-fixture detection.

## Exit-code contract

- **0** PASS
- **1** REGRESSION / FLAKY (contract failure)
- **2** ERROR (config, schema, provider, I/O)

## Design notes

- Evaluation is pure and unit-tested in isolation.
- Default provider is offline for deterministic CI.
- Live providers are opt-in; never required for the offline gate.
- Unknown assertion options are hard errors so contracts cannot silently no-op.

There is **no** supported web server or dashboard in the 0.1.1 product surface. Desurf is a CLI.
