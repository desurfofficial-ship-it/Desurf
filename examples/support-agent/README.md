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

- **required** — `"category"` and `billing` must appear
- **forbidden** — must not contain `I am an AI`
- **json_schema** — object with `category` and `explanation`
- **regex** — `"category": "billing"`

## Why the regressed output fails

`outputs/regressed.json` uses category `other` and includes the forbidden phrase `I am an AI`, so required/forbidden/regex assertions fail → **REGRESSION**.
