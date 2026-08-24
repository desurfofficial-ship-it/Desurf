# Desurf — Dogfooding notes

Internal verification of reliability states against real suite fixtures and the CLI.

## Matrix (offline)

| State | How produced | Observed |
|-------|----------------|----------|
| PASS | `fixtures/basic` offline, `--repeat 3` | PASS, exit 0 |
| REGRESSION | `examples/support-agent` case `support-classifier-regressed` | REGRESSION, exit 1 |
| FLAKY | Mock provider alternating pass/fail (unit/integration tests) | FLAKY classification |
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

## Problems discovered

1. **Weak substring `required`**  
   `required: "billing"` **passes** on the regressed fixture because the word appears in the explanation while `category` is `"other"`.  
   Product behavior is consistent with “substring required”; the **example** was misleading.  
   **Fix:** removed weak `required: "billing"` from `examples/support-agent`; document that field *values* should use **regex** (or structured checks).

2. **Offline CLI cannot produce FLAKY**  
   Expected for offline-first saved outputs. FLAKY needs varying outputs (live provider later, or tests with a mock provider). Documented in example README.

3. **CLI marks**  
   PASS uses `✓`; FLAKY/REGRESSION/ERROR use `✗`. Acceptable. Counts (`n/m passed`) appear when `--repeat` > 1.

## Problems fixed

- Example suite assertions tightened (no false-positive `required: "billing"`).
- Example README documents substring caveat.

## Remaining limitations

- Live OpenRouter provider exists (`--provider openrouter`) but requires `OPENROUTER_API_KEY`; offline remains the default CI path.
- `required` / `forbidden` are case-sensitive literal substrings (simple MVP; easy to misuse — prefer `regex` or `json_schema` for field values or case-insensitive checks).
- Package not published to public npm registry.

## Trust notes

- **PASS** on a suite you wrote with tight regex/schema assertions is trustworthy for those properties only.
- **REGRESSION** lists failed assertion messages — trustworthy if assertions encode the real contract.
- **FLAKY** classification logic is trustworthy; getting FLAKY from pure offline CLI is not expected.
- **ERROR** is clearly distinct from assertion failure (message + exit 2).
