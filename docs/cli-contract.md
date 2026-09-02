# Desurf — CLI Contract

This document is part of the public surface of Desurf.  
Do not change the exit-code meanings without explicit approval.

## Primary commands

- `desurf test --suite <path>` — evaluate contract suite against saved cassettes (offline) or live model
- `desurf init <directory>` — scaffold a new runnable suite (includes sealed example cassette)
- `desurf record --suite <path> --provider openrouter` — capture live output; propose drift (never mutates baseline unless `--force`)
- `desurf accept --suite <path> [--case <id>|--all] --yes` — promote a history snapshot to the baseline
- `desurf revert --suite <path> --case <id> --yes` — restore a baseline from a history backup
- `desurf diff --suite <path> --case <id>` — inspect a pending record snapshot
- `desurf history --suite <path>` — list cassette history snapshots
- `desurf seal --suite <path>` — establish offline cassette provenance (`.desurf` metadata) for existing output files
- `desurf watch --suite <path>` — re-run the suite whenever its files change (iteration loop)

## Cassette states

| State | On disk | Drift detection | How obtained |
|-------|---------|-----------------|--------------|
| **UNSEALED** | output only | no | legacy / manual output without seal |
| **SEALED** | output + `.desurf` | yes → exit **2** (hard error) | `desurf seal` (offline) |
| **RECORDED** | output + `.desurf` | yes → **WARNING** (soft; run stays green unless assertions fail) | `desurf record` (live provider) |

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

# Iteration loop
desurf watch --suite ./my-suite
```

After prompt or input changes:

- **Sealed** suite → `desurf test` returns **exit 2** (stale provenance). That is distinct from **exit 1** (assertions evaluated and failed). Refresh offline with `desurf seal --force` (keeps existing output; no provider), or obtain a new output with `desurf record --force`.
- **Recorded** suite → `desurf test` reports a **WARNING** and still evaluates the current assertions against the drifted baseline, showing a saved-vs-evaluated diff. The run stays green (exit 0) unless assertions fail. This keeps the iterate → re-record loop from crying wolf on every intentional prompt edit.

## Watch options

| Option | Meaning | Notes |
|--------|---------|-------|
| `--suite <path>` | Path to a test suite directory or suite.json | Required |
| `--case <id>` | Run only the named test case | Optional |
| `--repeat <n>` | Execute each selected case N times | Default 1 |
| `--provider <name>` | `offline` (default), `openrouter`, `openai`, `anthropic`, `gemini` | Offline uses saved outputs; other providers are live |
| `--debounce-ms <n>` | Quiet window before re-running after a change | Default 250 |

Watch re-runs the suite on every change to the suite directory (inputs/, prompts/, outputs/, suite.json), debounced, and prints the same per-run summary plus any regression diffs. Ctrl+C stops with exit 0.

## Test options

| Option | Meaning | Notes |
|--------|---------|-------|
| `--suite <path>` | Path to a suite directory or suite.json | Required for normal usage |
| `--case <id>` | Run only the named test case | Optional |
| `--repeat <n>` | Execute each selected case N times | Default 1 |
| `--provider <name>` | `offline` (default), `openrouter`, `openai`, `anthropic`, `gemini` | Offline uses saved outputs; other providers are live |
| `--model <id>` | Model id for live providers | Uses provider default if omitted (`openai/gpt-4o-mini`, `gpt-4o-mini`, `claude-3-5-haiku-20241022`, `gemini-2.0-flash`) |

## Record options

| Option | Meaning | Notes |
|--------|---------|-------|
| `--suite <path>` | Path to a test suite directory or suite.json | Required |
| `--provider <name>` | `openrouter`, `openai`, `anthropic`, `gemini` | Required live provider (offline is rejected) |
| `--model <id>` | Model id for live providers | Uses provider default if omitted |
| `--case <id>` | Record only the named test case | Optional |
| `--force` | Overwrite existing non-empty output files | Optional (skips by default) |

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
| `OPENROUTER_API_KEY` | When `--provider openrouter` (test or record) |
| `OPENAI_API_KEY` | When `--provider openai` (test or record) |
| `ANTHROPIC_API_KEY` | When `--provider anthropic` (test or record) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | When `--provider gemini` (test or record) |

Never commit API keys. Prefer the shell environment or a gitignored local `.env`.

## Offline vs live

| Mode | Provider | Deterministic? | Typical use |
|------|----------|----------------|-------------|
| **Offline** (default) | Saved outputs on disk | Yes | Contract suites, required CI |
| **Live** | e.g. OpenRouter, OpenAI, Anthropic, Gemini | No | Optional capture/check of a real model against a contract |

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
- **Exit 2** means the run could not evaluate (missing/invalid credentials, network/HTTP errors, timeout, empty response, bad configuration, **stale sealed cassette provenance**). Stale **recorded** cassette provenance is a soft WARNING (exit 0 unless assertions fail).
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

Provider failures (missing key, network error, HTTP 4xx/5xx, timeout, malformed response) and stale **sealed** cassettes surface as case **ERROR** and yield exit code **2**. Stale **recorded** cassettes surface as a case **WARNING** (exit code stays 0 unless assertions fail).

## Reliability states (reminder)

- **PASS** — every requested execution passed its assertions.
- **FLAKY** — at least one pass and at least one fail, no execution error.
- **REGRESSION** — every execution completed but failed assertions.
- **ERROR** — one or more executions could not be evaluated (provider / config / tool / stale provenance failure).

## CI policy

### GitHub Action

Consumers can gate PRs with the composite Action at the repository root (`action.yml`):

```yaml
- uses: desurfofficial-ship-it/Desurf@main   # or full commit SHA; only existing refs
  with:
    suite: ./desurf-suite
    version: "1.0.0"   # published npm package pin (never "latest")
```

- Action ref and npm `version` are **independent** pins; the Action installs the published package, not the Action checkout source.
- `@main` is a moving development ref; prefer a commit SHA for production. A stable `v0.4` Action tag is reserved for the future v0.4 release and does not exist until that release is cut.
- npm install may use the network; the **test** invocation is offline (no provider / no `OPENROUTER_API_KEY` / no record).
- Exit codes **0 / 1 / 2** are propagated unchanged.
- Install is isolated to a temporary directory (consumer workspace package files are not modified).
- Stale sealed/recorded cassettes → exit **2**; refresh with `desurf seal --force` or `desurf record --force`.

- Required CI is **offline and deterministic** (saved outputs only).
- Live OpenRouter requires a real API key and is **not** part of the required CI gate.
- Unit tests mock HTTP; they do not call the network.

## Notes for implementers

- Default provider is offline (saved outputs). Live OpenRouter is opt-in via `--provider openrouter`.
- The CLI itself must not contain assertion or reliability logic; it delegates to the runner / engine.
- Exit codes are part of the public API and must remain stable.
- Never log or print `OPENROUTER_API_KEY`.
- `desurf seal` must never perform network I/O.

## Drift-watch policy

Scheduled live runs are **monitoring**, not merge gates. Exit-code semantics are unchanged (0/1/2). Classification of drift vs flaky vs infra MUST use the `--json` payload (`cases[].state`), never the exit code alone (exit 1 is REGRESSION or FLAKY).

## Record / history exit codes (v0.5.0)

### `desurf record`
| Situation | Exit |
|-----------|------|
| Any case `error` | **2** |
| No errors, ≥1 `drift` (propose mode) | **1** |
| All cases `new` / `unchanged` | **0** |
| `--force` or `--fill-gaps` | **2** on error, else **0** |

### `desurf accept` / `desurf revert`
| Situation | Exit |
|-----------|------|
| Success | **0** |
| Nothing to accept/revert | **1** |
| Integrity / missing `--yes` (always required; no interactive prompt) | **2** |

## Multi-turn conversations (`turns`) — v0.7.0

A case may define `turns` (1–20) instead of `input`. Each turn is `{ "user": "<path>", "assertions"?: [...] }`.
- `prompt` remains required (system/base instruction for the whole conversation).
- `input` and `turns` are mutually exclusive (both present → exit 2).
- Output must be a `.json` transcript: `{ "version": 1, "turns": [{ "user", "output" }] }`.
- Per-turn assertions evaluate that turn's output; case-level assertions evaluate the **last** turn only.
- Assertion failure mid-conversation continues remaining turns; provider error stops the conversation.
- History/diff/accept/revert operate on the transcript as an atomic unit.


### `--json` multi-turn fields (v0.7.0)

For a turns case, each `executions[]` entry includes:

- `turns`: `[{ index, passed, assertionResults, outputPreview?, error? }]` — omitted for single-turn cases.
- `assertionFailures[].turnIndex` — present when the failure was evaluated on a specific turn.

### `desurf diff` with no pending snapshot

When there is no record snapshot for the case, `desurf diff` exits **1** with a not-found message (same family as accept/revert “nothing to accept”).
