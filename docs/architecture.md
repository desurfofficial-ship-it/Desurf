# Desurf Architecture

Desurf is intentionally small. The design goal is a deterministic offline regression gate for AI prompt behavior.

## Layers

1. **CLI** (`src/cli.ts`) — arg parsing, help, version, command dispatch (`test` / `init` / `record`), exit codes. No evaluation logic.
2. **Runner** (`src/runner.ts`) — loads suite, executes cases (with optional repeat), classifies reliability, aggregates summary.
3. **Init** (`src/init.ts`) — scaffolds a runnable structured-output example suite.
4. **Record** (`src/record.ts`) — captures live provider outputs into suite output files.
5. **Offline loader** (`src/offline.ts`) — reads `suite.json`, resolves paths, validates assertion shapes (unknown fields rejected).
6. **Assertions** (`src/assertions.ts`) — evaluates `required`, `forbidden`, `regex`, `json_schema` against model output text.
7. **Providers** (`src/provider.ts`, `src/openrouter.ts`, `src/create-provider.ts`) — offline saved-output adapter and optional live OpenRouter adapter.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | PASS |
| 1 | REGRESSION or FLAKY |
| 2 | ERROR (config, provider, empty suite, etc.) |

## Design constraints

- Offline-by-default: no network required for `desurf test`.
- No LLM-as-judge in the core path.
- Assertions express behavioral contracts, not full golden strings.
- Schema safety: unknown assertion fields fail at load time (exit 2).
