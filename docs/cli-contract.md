# Desurf — CLI Contract

This document is part of the public surface of Desurf.  
Do not change the exit-code meanings without explicit approval.

## Primary command

```bash
desurf test
```

## Options

| Option | Meaning | Notes |
|--------|---------|-------|
| `--suite <path>` | Path to a test suite directory or suite.json | Required for normal usage |
| `--case <id>` | Run only the named test case | Optional |
| `--repeat <n>` | Execute each selected case N times | Default 1 |
| `--provider <name>` | `offline` (default) or `openrouter` | Offline uses saved outputs; openrouter is live |
| `--model <id>` | Model id for live providers | Default for openrouter: `openai/gpt-4o-mini` |

## Environment

| Variable | When required |
|----------|----------------|
| `OPENROUTER_API_KEY` | Only when `--provider openrouter` |

Never commit API keys. Prefer the shell environment or a gitignored local `.env`.

## Examples

Offline (CI / default):

```bash
desurf test --suite fixtures/basic --repeat 3
```

Live OpenRouter (requires a real API key; not used in CI):

```bash
export OPENROUTER_API_KEY=...
desurf test \
  --suite examples/support-agent \
  --case support-classifier-good \
  --provider openrouter \
  --model openai/gpt-4o-mini
```

## Expected human-readable output (illustrative)

```
Desurf

✓ support-classifier-good
  PASS
  3/3 passed

Results: 1 passed, 0 flaky, 0 regression, 0 error
```

Exact formatting may evolve; the reliability classification and counts must remain clear.

## Exit-code contract (public API)

| Exit code | Meaning |
|-----------|---------|
| **0** | All selected tests are **PASS** |
| **1** | Quality-gate failure: at least one **REGRESSION** or **FLAKY** |
| **2** | Execution / configuration / provider / tool error (could not evaluate cleanly) |

CI systems depend on these values. They must remain stable.

Provider failures (missing key, network error, HTTP 4xx/5xx, timeout, malformed response) surface as case **ERROR** and yield exit code **2**.

## Reliability states (reminder)

- **PASS** — every requested execution passed its assertions.
- **FLAKY** — at least one pass and at least one fail, no execution error.
- **REGRESSION** — every execution completed but failed assertions.
- **ERROR** — one or more executions could not be evaluated (provider / config / tool failure).

## CI policy

- Default CI is **offline and deterministic** (saved outputs only).
- Live OpenRouter tests require a real API key and are **not** part of the required CI gate.
- Unit tests mock HTTP; they do not call the network.

## Notes for implementers

- Default provider is offline (saved outputs). Live OpenRouter is opt-in via `--provider openrouter`.
- The CLI itself must not contain assertion or reliability logic; it delegates to the runner / engine.
- Exit codes are part of the public API and must remain stable.
- Never log or print `OPENROUTER_API_KEY`.
