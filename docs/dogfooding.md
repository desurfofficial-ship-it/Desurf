# Internal dogfooding (pre-external validation)

Goal: break Desurf ourselves before asking other developers to trust it.

Date: 2026-08-24  
Repo: https://github.com/desurfofficial-ship-it/Desurf

## What was exercised

Real CLI (`dist/cli.js`) and real runner API:

| Scenario | Mechanism | Expected |
|----------|-----------|----------|
| PASS | `fixtures/basic` offline, `--repeat 3` | PASS, exit 0 |
| REGRESSION | `examples/support-agent` regressed case | REGRESSION, exit 1 |
| FLAKY | Runner + deterministic SequenceProvider | FLAKY, exit 1 (via CLI mapping) |
| ERROR | Missing suite / missing case / missing output file | ERROR or tool error, exit 2 |

## Commands and observed results

### PASS

```bash
node dist/cli.js test --suite fixtures/basic --repeat 3
```

Observed: `PASS`, `3/3 passed`, exit **0**.

### REGRESSION

```bash
node dist/cli.js test --suite examples/support-agent --case support-classifier-regressed --repeat 2
```

Observed: `REGRESSION`, `0/2 passed`, failed assertion messages listed, exit **1**.

### FLAKY

Not possible with a fixed offline saved output (by design).  
Demonstrated with the real `runSuite` + mock provider alternating good/bad JSON → state **FLAKY**, `2/3` pass count.

### ERROR

```bash
node dist/cli.js test --suite fixtures/does-not-exist   # exit 2
node dist/cli.js test --suite fixtures/basic --case no-such-case   # exit 2
# suite pointing at missing output file → case state ERROR, exit 2
```

## Live OpenRouter (optional dogfood)

The OpenRouter path was verified end-to-end through the real CLI/adapter (not a raw HTTP probe).

Findings that must stay clear in product docs:

- Offline suites (`fixtures/basic`, `examples/support-agent`) are **behavioral contracts**, not provider smoke tests.
- A live run can return **REGRESSION (exit 1)** when the model output violates the contract (e.g. non-JSON when `json_schema` is required) even though authentication and the adapter path succeeded.
- That is expected model variability, **not** proof that OpenRouter integration is broken.
- Integration/provider failure is **exit 2** (missing/invalid key, HTTP/network errors, empty response).
- Required CI remains offline-only; live runs are manual/optional.

Example optional invocation:

```bash
export OPENROUTER_API_KEY=...
node dist/cli.js test \
  --suite fixtures/basic \
  --case support-classifier-good \
  --provider openrouter \
  --model openai/gpt-4o-mini \
  --repeat 1
```

## Problems discovered

1. **Weak substring `required`**  
   `required: "billing"` **passes** on the regressed fixture because the word appears in the explanation while `category` is `"other"`.  
   Product behavior is consistent with “substring required”; the **example** was misleading.  
   **Fix:** removed weak `required: "billing"` from `examples/support-agent`; document that field *values* should use **regex** (or structured checks).

2. **Offline CLI cannot produce FLAKY**  
   Expected for offline-first saved outputs. FLAKY needs varying outputs (live provider or tests with a mock provider). Documented in example README.

3. **CLI marks**  
   PASS uses `✓`; FLAKY/REGRESSION/ERROR use `✗`. Acceptable. Counts (`n/m passed`) appear when `--repeat` > 1.

## Problems fixed

- Example suite assertions tightened (no false-positive `required: "billing"`).
- Example README documents substring caveat.
- Offline vs live expectations documented (contract failure ≠ integration failure).

## Remaining limitations

- Live OpenRouter is opt-in; required CI does not call live models.
- `required` / `forbidden` are case-sensitive literal substrings (simple MVP; prefer `regex` / `json_schema` when needed).
- Package not published to public npm registry.

## Trust notes

- **PASS** on a suite you wrote with tight regex/schema assertions is trustworthy for those properties only.
- **REGRESSION** lists failed assertion messages — trustworthy if assertions encode the real contract.
- **FLAKY** classification logic is trustworthy; getting FLAKY from pure offline CLI is not expected.
- **ERROR** is clearly distinct from assertion failure (message + exit 2).
- Live **REGRESSION** is evidence about **model output vs contract**, not automatic evidence that the provider adapter is broken.
