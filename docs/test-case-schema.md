# Desurf — Test Case & Suite Schema

This document describes the shape of suites, test cases, and assertions as implemented in Desurf 0.1.1.

## Suite

A suite is a directory containing `suite.json` and linked files (inputs, prompts, outputs).

Typical layout:

```
examples/support-agent/
┌── suite.json
┌── prompts/
┌── inputs/
┌── outputs/
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

Literal substring match on the full model output text. **Default is case-sensitive.** Optional `"caseSensitive": false` enables case-insensitive matching.

```json
{ "type": "required", "value": "distributed" }
{ "type": "required", "value": "as an ai", "caseSensitive": false }
```

### `forbidden`

Literal substring absence check. **Default is case-sensitive.** Optional `"caseSensitive": false`.

```json
{ "type": "forbidden", "value": "sorry" }
{ "type": "forbidden", "value": "as an AI", "caseSensitive": false }
```

### `regex`

JavaScript `RegExp` semantics: `new RegExp(pattern, flags ?? "")`.

### `json_schema`

**Minimal** structured check (not full JSON Schema), against the **parsed** JSON value:

- Output must parse as JSON
- If `schema.type === "object"`, value must be a non-null object (not an array)
- If `schema.required` is an array of strings, those keys must exist
- `schema.properties.<name>.const` — equality against the parsed property value
- `schema.properties.<name>.enum` — membership against the parsed property value

```json
{
  "type": "json_schema",
  "schema": {
    "type": "object",
    "required": ["category"],
    "properties": {
      "category": { "const": "billing" }
    }
  }
}
```

## Schema safety

Unknown assertion fields are **rejected** at load time (configuration error → exit 2). A typo must never silently pass.

## Design rules

- Prefer explicit behavioral properties over exact full-string matching.
- Keep the assertion set small until real use cases justify more kinds.
- Do not weaken offline contract fixtures to accommodate live-model variability.
