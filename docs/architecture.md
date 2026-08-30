# Architecture

Desurf is a small offline-first CLI for prompt regression testing.

## Layers

1. **CLI** (`src/cli.ts`) — arg parsing, help, version, command dispatch (`test` / `init` / `record` / `seal`), exit codes. No evaluation logic.
2. **Loader** (`src/offline.ts`) — reads `suite.json`, validates assertion fields, resolves paths (directory or direct `suite.json`).
3. **Init** (`src/init.ts`) — scaffolds a runnable structured-output example suite (sealed by default).
4. **Record** (`src/record.ts`) — live provider → write output files and `.desurf` metadata (no assertion evaluation).
5. **Seal** (`src/seal.ts`) — offline provenance → write `.desurf` metadata for existing output files without live provider or network calls.
6. **Runner** (`src/runner.ts`) — orchestrates load → provider → engine → reliability summary.
7. **Engine** (`src/engine.ts`) — pure: TestCase + ModelOutput → TestResult.
8. **Assertions** (`src/assertions.ts`) — pure evaluation of required / forbidden / regex / json_schema.
9. **Providers** (`src/provider.ts`, `src/openrouter.ts`, `src/create-provider.ts`) — `ModelAdapter` interface; offline saved-output vs OpenRouter.
10. **Reliability** (`src/repeat.ts`) — PASS / FLAKY / REGRESSION / ERROR from N executions.
11. **Fingerprint** (`src/fingerprint.ts`) — SHA-256 sidecar calculation and stale-fixture detection.

## Cassette provenance

- **UNSEALED** — output only; assertions run; no drift detection (backward compatible).
- **SEALED** — `desurf seal` wrote `.desurf` from current input/prompt hashes (offline).
- **RECORDED** — `desurf record` wrote output + `.desurf` from a live provider.

Stale sealed/recorded cassettes (prompt or input hash mismatch) map to **ERROR / exit 2**, not REGRESSION. Assertion failures on a fresh cassette map to **REGRESSION / exit 1**.

## Exit-code contract

- **0** PASS
- **1** REGRESSION / FLAKY (contract failure)
- **2** ERROR (config, schema, provider, I/O, stale provenance)

## Design notes

- Evaluation is pure and unit-tested in isolation.
- Default provider is offline for deterministic CI.
- Live providers are opt-in; never required for the offline gate.
- Unknown assertion options are hard errors so contracts cannot silently no-op.
- `seal` is network-free by construction.

There is **no** supported web server or dashboard in the product surface. Desurf is a CLI.
