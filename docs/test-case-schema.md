# Desurf — Test Case & Suite Schema

This document describes the shape of suites, test cases, and assertions as implemented in Desurf 0.1.0.

## Suite

A suite is a directory containing `suite.json` and linked files (inputs, prompts, outputs).

Typical layout:

```
examples/support-agent/
├── suite.json
├── prompts/
├── inputs/
├── outputs/
└── README.md
```

`suite.json` includes a name and a list of cases. Paths in cases are resolved relative to the suite directory.

## Test case fields

| Field | Purpose |
|-------|---------|
| `id` | Stable unique identifier within the suite |
| `input` | Path to the user / application input file |
| `prompt` | Path to the prompt file under test |
| `output` | Path to the saved model output (required by the loader; used by offline provider) |
| `assertions` | List of behavioral assertions that must hold |

The offline provider reads `output`. Live providers ignore the saved file contents and still require the field for schema/loader compatibility.

## Assertions

Assertions express the **behavioral contract**, not a full golden string. Types match `src/types.ts` and `src/assertions.ts`.

### `required`

Case-sensitive **literal substring** match on the full model output text.

```json
{ "type": "required", "value": "distributed" }
```

- Matches: `"distributed systems"`
- Does **not** match: `"Distributed systems"`

Use `regex` with the `i` flag when case must be ignored.

### `forbidden`

Case-sensitive **literal substring** absence check on the full model output text.

```json
{ "type": "forbidden", "value": "sorry" }
```

- Passes when `"sorry"` is absent
- Does **not** reject: `"Sorry, your request..."` (different case)

### `regex`

JavaScript `RegExp` semantics: `new RegExp(pattern, flags ?? "")`.

| Flags | Case behavior |
|-------|----------------|
| *(none)* | Case-sensitive (default) |
| `i` | Case-insensitive |

```json
{ "type": "regex", "pattern": "\\bdistributed\\b", "flags": "i" }
```

Malformed patterns or invalid flags do not crash the process; the assertion fails with an `Invalid regex` message.

### `json_schema`

**Minimal** structured check (not full JSON Schema):

- Output must parse as JSON
- If `schema.type === "object"`, value must be a non-null object (not an array)
- If `schema.required` is an array of strings, those keys must exist on the object

```json
{
  "type": "json_schema",
  "schema": { "type": "object", "required": ["category", "explanation"] }
}
```

## Evaluation model

```
TestCase + Model Output
        ↓
Evaluate each Assertion
        ↓
Assertion Results
        ↓
Test Result (pass / fail for this execution)
```

With repeated execution the reliability engine aggregates into PASS, FLAKY, REGRESSION, or ERROR.

## Offline vs live

- **Offline (default):** model text comes from the saved `output` file. Deterministic. Required CI path.
- **Live (optional):** e.g. `--provider openrouter`. Same assertions run on live model text. **PASS is not guaranteed.** REGRESSION (exit 1) means the contract failed on usable output; ERROR (exit 2) means the provider/config path failed.

## Design rules

- Prefer explicit behavioral properties over exact full-string matching.
- Keep the assertion set small until real use cases justify more kinds.
- Do not weaken offline contract fixtures to accommodate live-model variability.
