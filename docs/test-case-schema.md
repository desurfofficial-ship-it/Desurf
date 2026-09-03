# Desurf — Test Case & Suite Schema

This document describes the shape of suites, test cases, and assertions as implemented in Desurf.

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

**Minimal** structured check (not full JSON Schema), against the **parsed** JSON value.

Supported schema keywords (only these; recursive on nested property / items schemas):

- `type` (top-level: only `"object"`; on properties: `string` | `number` | `integer` | `boolean` | `object` | `array` | `null`)
- `required` (array of strings)
- `properties` (object of nested schemas)
- `const` (primitive only)
- `enum` (array of primitives)
- `items` (single schema object, for array properties)

**Unknown, misspelled, or unsupported keywords are rejected at load time (exit 2).**
A typo such as `"requried"` or an unsupported keyword such as `"additionalProperties"`
must never silently weaken the contract.

Evaluation rules:

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

Unknown assertion fields and unknown / unsupported JSON Schema keywords (at any nesting level) are **rejected** at load time (configuration error → exit 2). A typo must never silently pass or weaken a behavioral contract.

## Design rules

- Prefer explicit behavioral properties over exact full-string matching.
- Keep the assertion set small until real use cases justify more kinds.
- Do not weaken offline contract fixtures to accommodate live-model variability.

## turns (v0.7.0)

Optional array of 1–20 objects: `{ "user": "<relative path>", "assertions"?: Assertion[] }`.
Mutually exclusive with `input`. Output must end in `.json` (transcript cassette).


See `docs/cli-contract.md` for `diff` / `--json` behavior on turns cases.


- **`allowFences`** (optional, default `false`): opt-in. When `true`, if the strict JSON parse fails, Desurf parses the **first** markdown fenced JSON block. If no fenced block parses, the original strict error (`Output is not valid JSON`) is preserved.

```json
{ "type": "json_schema", "schema": { "type": "object", "required": ["category"] }, "allowFences": true }
```

See [docs/assertions-cookbook.md](assertions-cookbook.md) for authoring guidance.

### `max_diff_lines` (v0.8.0)

`{ "type": "max_diff_lines", "value": <N> }` — `N` integer ≥ 0. Fails when unified-diff changed lines (`+`/`-`, normalized) exceed the budget.

- **Live / record**: reference = committed baseline file; compared = fresh model output.
- **Offline**: reference = most recent `baseline-backup` in `.desurf-history`; compared = committed output. **No history → trivial pass** (initial baseline is human-approved).
- `value: 0` means exact match. Message includes actual vs budget and points at `desurf diff --full`.

### `json_path` (v0.8.0)

`{ "type": "json_path", "path": "a.b[0].c", ...one comparison... }`

Path: dot keys + numeric `[index]`; optional leading `$.`. Malformed path → load exit **2**.

Exactly one comparison group:
- `equals` — strict deep equality (no coercion: `1` ≠ `"1"`)
- `oneOf` — non-empty array, deep equality against any element
- `min` / `max` — inclusive numeric bounds (alone or together)

JSON parse failure or path miss → assertion failure (exit **1**), not config error.

Unknown fields on any assertion object still fail load (exit **2**).
