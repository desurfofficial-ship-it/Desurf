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

## Milestone: v0.2 — Init onboarding improved (2026-08-28)

Merged on `main` as `7bc52c9` (PR #2).

Desurf `init` now scaffolds a realistic structured-output AI contract instead of the previous toy math / `required: "hello"` example.

The generated workflow demonstrates:

```
input
→ prompt
→ recorded AI output
→ assertions/schema
→ deterministic PASS
→ intentional REGRESSION
→ restored PASS
```

The example remains offline-first and does not require a live provider.

Verification: 91 tests green; init suite PASS (exit 0); mutated cassette → REGRESSION (exit 1); restored → PASS (exit 0).

---

## F-5 — Real GitHub Actions drift-watch soak (2026-09-02)

**Status: CLOSED**

Production path validated on GitHub-hosted runners using published
`@desurfofficial-ship-it/desurf@0.9.0` and repository secret `OPENROUTER_API_KEY`
(never logged).

### Real GitHub evidence

| Field | Value |
|-------|-------|
| Date | 2026-09-02T01:51Z–01:56Z UTC |
| Workflow | Desurf drift-watch (`.github/workflows/desurf-drift-watch.yml`) |
| First run | [33581023616](https://github.com/desurfofficial-ship-it/Desurf/actions/runs/33581023616) — fixtures/basic → REGRESSION → class=`drift` → issue **#9** |
| Dedup run | [33581099715](https://github.com/desurfofficial-ship-it/Desurf/actions/runs/33581099715) — comment on #9, no second issue |
| Controlled drift | [33581206590](https://github.com/desurfofficial-ship-it/Desurf/actions/runs/33581206590) — dogfood forced fail → issue **#10** |
| Recovery | [33581271752](https://github.com/desurfofficial-ship-it/Desurf/actions/runs/33581271752) — exit 0 → #10 closed with recovered comment |
| Desurf version | 0.9.0 (npm pin) |
| Provider / model | openrouter / openai/gpt-4o-mini |
| Commit (workflow install) | `a7193de` |
| Secrets | OPENROUTER_API_KEY referenced only as `${{ secrets.OPENROUTER_API_KEY }}` |

### Lifecycle matrix

| Step | Result |
|------|--------|
| Healthy / recovery run | PASS exit 0 on dogfood suite |
| Drift detection | REGRESSION → classify `drift` |
| Issue creation | #9 (basic), #10 (dogfood) |
| Deduplication | Second basic run commented #9 only |
| Recovery + close | #10 closed by drift-watch bot |

### Problems discovered

1. **Workflow jq path** used `.suiteName` but `--json` emits `suite` → all issues
   shared fingerprint `suite`. Fixed in `9fc72fa` to `.suite // .suiteName`.
2. **fixtures/basic** + gpt-4o-mini often returns markdown-fenced JSON → json_schema
   REGRESSION (expected model variability; not an OpenRouter auth failure).
3. **Node 20 deprecation warning** on checkout/setup-node actions (runner default Node 24).

### Changes made for F-5

- `.github/workflows/desurf-drift-watch.yml` installed from example (0.8.0 pin at F-5; bumped to 0.9.0 in the H7 self-bump round — see below)
- `fixtures/drift-watch-dogfood/` lenient suite for recovery soak
- jq suite-name fix in production + example workflow
