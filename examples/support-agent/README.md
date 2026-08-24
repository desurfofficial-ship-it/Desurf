# Example: support-agent classifier

Canonical Desurf example from the product blueprint.

Customer says: *"I was charged twice for my subscription."*

The prompt asks the model to return JSON with `category` and `explanation`.

This suite is a **behavioral-contract** example. Offline runs use saved outputs and are deterministic. That is what CI and local regression gates should use.

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

## Optional live run

You may point the **same contract** at a live model. This is **manual/optional**, not part of required CI, and **PASS is not guaranteed**.

```bash
export OPENROUTER_API_KEY=...
desurf test \
  --suite examples/support-agent \
  --case support-classifier-good \
  --provider openrouter \
  --model openai/gpt-4o-mini \
  --repeat 1
```

- **Exit 1 (REGRESSION)** means the model returned usable text that failed the contract (for example, not valid JSON). That does **not** by itself mean OpenRouter integration is broken.
- **Exit 2** means the provider/config path failed (credentials, network, empty response, etc.).
- Live output is model-dependent; do not expect determinism.

## Assertions used

- **required** — `"category"` key must appear in the output text
- **forbidden** — must not contain `I am an AI`
- **json_schema** — object with `category` and `explanation` keys
- **regex** — `"category": "billing"` (the actual category *value*)

### Caveat (dogfooding finding)

`required` is **substring** matching on the raw output. Prefer **regex** (or tighter structured checks) when you need to assert a specific field *value*. A loose `required: "billing"` can pass when the word appears only in an explanation while `category` is wrong.

## Why the regressed output fails

`outputs/regressed.json` uses category `other` and includes the forbidden phrase `I am an AI`, so forbidden + regex assertions fail → **REGRESSION**.
