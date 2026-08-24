/**
 * Assertion evaluation.
 * Pure functions — no I/O, no CLI, no provider knowledge.
 */

import type { Assertion, AssertionResult, ModelOutput } from "./types.js";

function evaluateRequired(output: ModelOutput, value: string): AssertionResult {
  const passed = output.text.includes(value);
  return {
    assertion: { type: "required", value },
    passed,
    message: passed
      ? `Required content found: "${value}"`
      : `Required content missing: "${value}"`,
  };
}

function evaluateForbidden(output: ModelOutput, value: string): AssertionResult {
  const passed = !output.text.includes(value);
  return {
    assertion: { type: "forbidden", value },
    passed,
    message: passed
      ? `Forbidden content absent: "${value}"`
      : `Forbidden content present: "${value}"`,
  };
}

function evaluateRegex(
  output: ModelOutput,
  pattern: string,
  flags?: string
): AssertionResult {
  try {
    const re = new RegExp(pattern, flags ?? "");
    const passed = re.test(output.text);
    return {
      assertion: { type: "regex", pattern, flags },
      passed,
      message: passed
        ? `Regex matched: /${pattern}/${flags ?? ""}`
        : `Regex did not match: /${pattern}/${flags ?? ""}`,
    };
  } catch (err) {
    return {
      assertion: { type: "regex", pattern, flags },
      passed: false,
      message: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Minimal JSON-schema check for Stage 1:
 * - output must be valid JSON
 * - if schema.type === "object", result must be a non-null object
 * - if schema.required is present, those keys must exist
 * Full JSON Schema validation can be added later when justified.
 */
function evaluateJsonSchema(
  output: ModelOutput,
  schema: Record<string, unknown>
): AssertionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.text);
  } catch {
    return {
      assertion: { type: "json_schema", schema },
      passed: false,
      message: "Output is not valid JSON",
    };
  }

  if (schema.type === "object") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        assertion: { type: "json_schema", schema },
        passed: false,
        message: "Expected a JSON object",
      };
    }
  }

  if (Array.isArray(schema.required)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of schema.required) {
      if (typeof key !== "string") continue;
      if (!(key in obj)) {
        return {
          assertion: { type: "json_schema", schema },
          passed: false,
          message: `Missing required key: "${key}"`,
        };
      }
    }
  }

  return {
    assertion: { type: "json_schema", schema },
    passed: true,
    message: "JSON schema checks passed",
  };
}

/** Evaluate a single assertion against a model output. */
export function evaluateAssertion(
  assertion: Assertion,
  output: ModelOutput
): AssertionResult {
  switch (assertion.type) {
    case "required":
      return evaluateRequired(output, assertion.value);
    case "forbidden":
      return evaluateForbidden(output, assertion.value);
    case "regex":
      return evaluateRegex(output, assertion.pattern, assertion.flags);
    case "json_schema":
      return evaluateJsonSchema(output, assertion.schema);
    default: {
      // Exhaustiveness guard
      const _exhaustive: never = assertion;
      return {
        assertion: _exhaustive,
        passed: false,
        message: `Unknown assertion type`,
      };
    }
  }
}

/** Evaluate all assertions; overall pass only if every assertion passes. */
export function evaluateAssertions(
  assertions: Assertion[],
  output: ModelOutput
): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, output));
}
