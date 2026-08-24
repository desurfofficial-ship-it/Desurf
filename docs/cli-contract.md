# Desurf — CLI Contract

This document is part of the public surface of Desurf.  
Do not change the exit-code meanings without explicit approval.

## Primary command

```bash
desurf test
```

## Options (initial)

| Option          | Meaning                                      | Notes                          |
|-----------------|----------------------------------------------|--------------------------------|
| `--suite <path>`| Path to a test suite directory or suite.json | Required for normal usage      |
| `--case <id>`   | Run only the named test case                 | Optional                       |
| `--repeat <n>`  | Execute each selected case N times           | Stage 2+                       |
| `--offline`     | Force use of the saved-output provider       | Default behavior in Stage 1    |

## Example

```bash
desurf test \
  --suite examples/support-agent \
  --case support-classifier-good \
  --repeat 3
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

| Exit code | Meaning                                                                 |
|-----------|-------------------------------------------------------------------------|
| **0**     | All selected tests are **PASS**                                         |
| **1**     | Quality-gate failure: at least one **REGRESSION** or **FLAKY**          |
| **2**     | Execution / configuration / tool error (could not evaluate cleanly)     |

CI systems depend on these values.  
They must remain stable.

## Reliability states (reminder)

- **PASS** — every requested execution passed its assertions.
- **FLAKY** — at least one pass and at least one fail, no execution error.
- **REGRESSION** — every execution completed but failed assertions.
- **ERROR** — one or more executions could not be evaluated (provider / config / tool failure).

## Notes for implementers

- Stage 1 only needs a single execution path that can produce PASS (or ERROR).
- `--repeat` and the full four-state classification arrive in Stage 2.
- Exit codes become mandatory in Stage 3 (Regression Gate).
- The CLI itself must not contain assertion or reliability logic; it delegates to the runner / engine.
