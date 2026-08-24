# Example: support-agent classifier

Canonical Desurf example from the product blueprint.

Customer says: *"I was charged twice for my subscription."*

The prompt asks the model to return JSON with `category` and `explanation`.

## Cases

| Case id | Offline output | Expected reliability |
|---------|----------------|----------------------|
| `support-classifier-good` | `outputs/good.json` | **PASS** |
| `support-classifier-regressed` | `outputs/regressed.json` | **REGRESSION** |

**FLAKY** cannot be produced by a fixed offline file (same input → same saved output every time). It is demonstrated in automated tests with a deterministic mock provider that alternates good and bad outputs across `--repeat` runs.

## Run offline

```bash
# Good case only
npx tsx src/cli.ts test --suite examples/support-agent --case support-classifier-good

# Regressed case (expect exit 1)
npx tsx src/cli.ts test --suite examples/support-agent --case support-classifier-regressed

# Entire suite (will report 1 passed, 1 regression → exit 1)
npx tsx src/cli.ts test --suite examples/support-agent --repeat 3
```

## Assertions used

- **required** — `"category"` key must appear in the output text
- **forbidden** — must not contain `I am an AI`
- **json_schema** — object with `category` and `explanation` keys
- **regex** — `"category": "billing"` (the actual category *value*)

### Caveat (dogfooding finding)

`required` is **substring** matching on the raw output. Prefer **regex** (or tighter structured checks) when you need to assert a specific field *value*. A loose `required: "billing"` can pass when the word appears only in an explanation while `category` is wrong.

## Why the regressed output fails

`outputs/regressed.json` uses category `other` and includes the forbidden phrase `I am an AI`, so forbidden + regex assertions fail → **REGRESSION**.
