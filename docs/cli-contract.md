# Desurf — CLI Contract

This document is part of the public surface of Desurf.  
Do not change the exit-code meanings without explicit approval.

## Primary commands

- `desurf test --suite <path>` — evaluate contract suite against saved cassettes (offline) or live model
- `desurf init <directory>` — scaffold a new runnable suite (includes sealed example cassette)
- `desurf record --suite <path> --provider openrouter` — capture live model responses and generate `.desurf` metadata
- `desurf seal --suite <path>` — establish offline cassette provenance (`.desurf` metadata) for existing output files

## Cassette states

| State | On disk | Drift detection | How obtained |
|-------|---------|-----------------|--------------|
| **UNSEALED** | output only | no | legacy / manual output without seal |
| **SEALED** | output + `.desurf` | yes → exit **2** | `desurf seal` (offline) |
| **RECORDED** | output + `.desurf` | yes → exit **2** | `desurf record` (live provider) |

Unsealed suites remain fully supported for backward compatibility. Seal when you want provenance protection.

**When to seal vs record**

- Prefer **`desurf seal`** when you already trust an output file and want offline provenance (no API key, no network).
- Prefer **`desurf record`** when you need a new live capture; it writes output and `.desurf` together.

Recommended sequences:

```bash
# Existing response file
desurf seal --suite ./my-suite
desurf test --suite ./my-suite

# Live capture
desurf record --suite ./my-suite --provider openrouter
desurf test --suite ./my-suite
```

After prompt or input changes on a sealed/recorded suite, `desurf test` returns **exit 2** (stale provenance). That is distinct from **exit 1** (assertions evaluated and failed). Refresh with `desurf seal --force` (after updating the output) or `desurf record --force`.

## Test options

| Option | Meaning | Notes |
|--------|---------|-------|
| `--suite <path>` | Path to a test suite directory or suite.json | Required for normal usage |
| `--case <id>` | Run only the named test case | Optional |
| `--repeat <n>` | Execute each selected case N times | Default 1 |
| `--provider <name>` | `offline` (default) or `openrouter` | Offline uses saved outputs; openrouter is live |
| `--model <id>` | Model id for live providers | Default for openrouter: `openai/gpt-4o-mini` |

## Seal options

| Option | Meaning | Notes |
|--------|---------|-------|
| `--suite <path>` | Path to a test suite directory or suite.json | Required |
| `--case <id>` | Seal only the named test case | Optional |
| `--force` | Overwrite existing `.desurf` metadata files | Optional (skips by default) |

Seal rules (public behavior):

- Purely offline — no provider, model, or network.
- Requires a non-empty output file per selected case (missing or empty → case error / exit 2).
- Existing `.desurf` metadata is preserved unless `--force` is supplied.
- `--suite` accepts a directory or a direct path to `suite.json`.

## Environment

| Variable | When required |
|----------|----------------|
| `OPENROUTER_API_KEY` | Only when `--provider openrouter` (test or record) |

Never commit API keys. Prefer the shell environment or a gitignored local `.env`.

## Offline vs live

| Mode | Provider | Deterministic? | Typical use |
|------|----------|----------------|-------------|
| **Offline** (default) | Saved outputs on disk | Yes | Contract suites, required CI |
| **Live** | e.g. OpenRouter | No | Optional check of a real model against a contract |

Suites such as `fixtures/basic` and `examples/support-agent` are **behavioral-contract tests**, not provider-health smoke tests. Offline, they use fixed saved outputs. Against a live model, the **same assertions** run on variable model text—**PASS is not guaranteed**.

### Offline example (CI / default)

```bash
desurf test --suite fixtures/basic --repeat 3
```

### Optional live example (manual only — not required CI)

```bash
export OPENROUTER_API_KEY=...
desurf test \
  --suite fixtures/basic \
  --case support-classifier-good \
  --provider openrouter \
  --model openai/gpt-4o-mini \
  --repeat 1
```

- Live providers are **optional** and are **never** a merge gate.
- **Exit 1** on a live run means usable output was evaluated and the **contract failed** (REGRESSION/FLAKY). That does **not** by itself mean the OpenRouter integration is broken.
- **Exit 2** means the run could not evaluate (missing/invalid credentials, network/HTTP errors, timeout, empty response, bad configuration, **stale cassette provenance**).
- Live results are model- and provider-dependent; do not treat them as deterministic.

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
| **0** | **PASS** — contract evaluated and held |
| **1** | **REGRESSION** or **FLAKY** — contract evaluated but did not hold |
| **2** | **ERROR** — provider / configuration / tool / **stale provenance** failure (could not evaluate cleanly) |

CI systems depend on these values. They must remain stable.

Provider failures (missing key, network error, HTTP 4xx/5xx, timeout, malformed response) and stale sealed/recorded cassettes surface as case **ERROR** and yield exit code **2**.

## Reliability states (reminder)

- **PASS** — every requested execution passed its assertions.
- **FLAKY** — at least one pass and at least one fail, no execution error.
- **REGRESSION** — every execution completed but failed assertions.
- **ERROR** — one or more executions could not be evaluated (provider / config / tool / stale provenance failure).

## CI policy

- Required CI is **offline and deterministic** (saved outputs only).
- Live OpenRouter requires a real API key and is **not** part of the required CI gate.
- Unit tests mock HTTP; they do not call the network.

## Notes for implementers

- Default provider is offline (saved outputs). Live OpenRouter is opt-in via `--provider openrouter`.
- The CLI itself must not contain assertion or reliability logic; it delegates to the runner / engine.
- Exit codes are part of the public API and must remain stable.
- Never log or print `OPENROUTER_API_KEY`.
- `desurf seal` must never perform network I/O.
