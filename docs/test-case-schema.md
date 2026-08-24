# Desurf — Test Case & Suite Schema

This document describes the **conceptual** shape of suites, test cases, and assertions.  
The exact JSON schema must be finalized and documented **before** implementation invents it.  
Do not create TypeScript types until the reasons for each field are clear.

## Suite

A suite is a directory (or a single `suite.json`) that groups related test cases.

Conceptual contents:

- suite name / id
- list of test cases (or references to them)
- optional shared configuration
- links to (or embedding of) inputs, prompts, and saved outputs

Typical layout (from the blueprint):

```
examples/support-agent/
├── suite.json
├── prompts/
├── inputs/
├── outputs/
└── README.md
```

## Test Case

A test case describes one concrete scenario to evaluate.

Conceptual fields:

| Field        | Purpose                                              |
|--------------|------------------------------------------------------|
| `id`         | Stable unique identifier within the suite            |
| `input`      | The user / application input (or path to it)         |
| `prompt`     | The prompt (or path / template) under test           |
| `assertions` | List of behavioral assertions that must hold         |
| (later)      | metadata, tags, expected category, etc.              |

Illustrative TypeScript shape (not yet implemented):

```ts
type TestCase = {
  id: string;
  input: string;
  prompt: string;
  assertions: Assertion[];
};
```

The exact implementation may differ.  
Do not create the type until the surrounding code needs it.

## Assertions

Assertions are the heart of Desurf.  
They express the **behavioral contract**, not a golden string.

Initial assertion kinds (keep the set small):

### `required`

Case-sensitive **literal substring** match on the full model output.

```json
{ "type": "required", "value": "distributed" }
```

- Matches: `"distributed systems"`
- Does **not** match: `"Distributed systems"`

Use `regex` with the `i` flag when case must be ignored.

### `forbidden`

Case-sensitive **literal substring** absence check on the full model output.

```json
{ "type": "forbidden", "value": "sorry" }
```

- Passes when `"sorry"` is absent
- Does **not** reject: `"Sorry, your request..."` (different case)

Use `regex` with the `i` flag when case must be ignored.

### `regex`

JavaScript regular-expression semantics via `new RegExp(pattern, flags)`.

| Flags | Case behavior |
|-------|----------------|
| *(none)* | Case-sensitive (default) |
| `i` | Case-insensitive |

```json
{ "type": "regex", "pattern": "\\bdistributed\\b", "flags": "i" }
```

### `json_schema`

Minimal structured check: output must be valid JSON; optional `type: "object"` and `required` key list. Full JSON Schema validation is out of scope for the MVP.

Later kinds may be added only when real use cases justify them.

## Evaluation model (conceptual)

```
TestCase
   +
Model Output
   ↓
Evaluate each Assertion
   ↓
Assertion Results
   ↓
Overall Test Result (pass / fail for this execution)
```

With repeated execution the reliability engine aggregates multiple Test Results into one of:

- PASS
- FLAKY
- REGRESSION
- ERROR

## Offline / saved-output path

In Stage 1 the model output comes from a **saved file** (or fixture), not from a live LLM.

```
saved output file
      ↓
Desurf engine
      ↓
assertions evaluated
```

The engine must not care whether the output was produced by a live provider or loaded from disk.

## Design rules

- Prefer explicit behavioral properties over exact string matching.
- Keep the first set of assertion types intentionally small.
- Document the concrete JSON schema **before** writing the loader that consumes it.
- Never let the implementation invent the schema silently.
