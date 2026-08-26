# Desurf — Test Case & Suite Schema

This document describes the shape of suites, test cases, and assertions as implemented in Desurf 0.1.2.

## Suite

A suite is a directory containing `suite.json` and linked files (inputs, prompts, outputs).

**Configuration rules (exit 2 on violation):**

- `cases` must be a non-empty array — an empty suite is a configuration error.
- Case `id` values must be unique within the suite.
- Each case must have a non-empty `assertions` array.

Only `name` and `cases` are read at the suite level. Other top-level keys are currently ignored (harmless metadata). Assertion-level unknown fields are always rejected.

## Test case fields

| Field | Purpose |
|-------|---------|
| `id` | Stable unique identifier within the suite |
| `input` | Path to the user / application input file |
| `prompt` | Path to the prompt file under test |
| `output` | Path to the saved model output (required by the loader; used by offline provider) |
| `assertions` | Non-empty list of behavioral assertions that must hold |

## Assertions

### `required`

Literal substring match. **Default is case-sensitive.** Optional `"caseSensitive": false`.

### `forbidden`

Literal substring absence. **Default is case-insensitive.** Opt into exact match with `"caseSensitive": true`.

### `regex`

JavaScript `RegExp`. Invalid patterns are a **configuration error** at suite load time (exit 2). A valid pattern that fails to match is a regression (exit 1).

### `json_schema`

**Minimal Desurf dialect only.** Supported top-level keywords: `type` (only `"object"`), `required`, `properties`. Supported property keywords: `const`, `enum`.

Unsupported keywords (`minLength`, `minimum`, `maximum`, `pattern`, `items`, `additionalProperties`, nested `properties`, property-level `type`, root-level `const`/`enum`) are **rejected at load time (exit 2)**.

## Schema safety

- Unknown assertion fields → exit 2
- Unsupported json_schema keywords → exit 2
- Invalid regex patterns → exit 2
- Empty suites / empty assertion lists → exit 2
- Duplicate case IDs → exit 2

A typo or unsupported contract instruction must never silently pass.
