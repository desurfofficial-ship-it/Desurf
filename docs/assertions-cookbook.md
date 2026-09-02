# Desurf assertion authoring cookbook

Guidance from production soaks (v0.8.0 F-5 dogfood and live provider runs). Prefer stable behavioral contracts over brittle string matching.

## 1. Volatile literals

**Soak behavior:** A `required` assertion on the literal token `OPS-503` failed when the model paraphrased the token away (soak A).

**Rule:** Never assert timestamps, counters, request IDs, or model self-references as `required`. Assert categories, schema shape, and stable tokens. Use `forbidden` for self-reference suppression (e.g. `"I am an AI"` — the `fixtures/basic` pattern).

```json
{
  "assertions": [
    { "type": "required", "value": "\"category\"" },
    { "type": "required", "value": "billing" },
    { "type": "forbidden", "value": "I am an AI" }
  ]
}
```

## 2. Fences and allowFences

**Soak behavior:** `gpt-4o-mini` on `fixtures/basic` returned markdown-fenced JSON → `json_schema` REGRESSION on otherwise healthy output (docs/dogfooding.md, F-5 finding #2). The GLM soak bridge showed the same pattern.

**Rule:** Strict JSON parse is always tried first. `allowFences: true` (opt-in, default `false`) parses the **first** markdown-fenced block when strict parse fails. If no fenced block parses, the original `Output is not valid JSON` error is preserved.

```json
{
  "type": "json_schema",
  "schema": { "type": "object", "required": ["category"] },
  "allowFences": true
}
```

## 3. Budget sizing

**Soak behavior:** Healthy repeats drifted one to four changed lines per run; the soak suite used `max_diff_lines: 25`.

**Rule:** Measure variance with `--repeat 3`, then set the budget at roughly three times the observed maximum. Since H3 the count is computed on full texts (exact count; display-only truncation note when the rendered diff is capped).

```json
{ "type": "max_diff_lines", "value": 25 }
```

## 4. Provider errors

**Soak behavior:** Sustained 429s surfaced as case `ERROR` with exit **2** (infrastructure class) — fail-closed; the gate does not pass on provider outage.

**Rule:** Transient statuses are 408/429/5xx/network (`src/provider-utils.ts`). `--max-retries` (default 0, max 5) or `DESURF_MAX_RETRIES` buys backoff retries. Retries mask transport jitter; they never convert validation failures into passes.

```bash
desurf test --suite ./suite --provider openrouter --model openai/gpt-4o-mini --max-retries 3
```
