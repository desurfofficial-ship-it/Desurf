/**
 * Assertion evaluation.
 * Pure functions — no I/O, no CLI, no provider knowledge.
 */

import type { Assertion, AssertionResult, ModelOutput } from "./types.js";
import {
  RegexSandbox,
  RegexTimeoutError,
  regexTimeoutMs,
} from "./regex-sandbox.js";

// Module-level singleton: one persistent evaluation worker for the whole
// run (lazily spawned, reused across cases/repeats, terminated only when a
// regex wedges past its deadline).
const regexSandbox = new RegexSandbox();

function includesWithCase(
  haystack: string,
  needle: string,
  caseSensitive: boolean
): boolean {
  if (caseSensitive) {
    return haystack.includes(needle);
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function evaluateRequired(
  output: ModelOutput,
  value: string,
  caseSensitive: boolean
): AssertionResult {
  const passed = includesWithCase(output.text, value, caseSensitive);
  return {
    assertion: { type: "required", value, caseSensitive },
    passed,
    message: passed
      ? `Required content found: "${value}"`
      : `Required content missing: "${value}"`,
  };
}

function evaluateForbidden(
  output: ModelOutput,
  value: string,
  caseSensitive: boolean
): AssertionResult {
  const passed = !includesWithCase(output.text, value, caseSensitive);
  return {
    assertion: { type: "forbidden", value, caseSensitive },
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
  let passed: boolean;
  try {
    passed = regexSandbox.test(
      pattern,
      flags ?? "",
      output.text,
      regexTimeoutMs()
    );
  } catch (err) {
    if (err instanceof RegexTimeoutError) {
      // Evaluation hazard, not a behavioral result: propagate so the runner
      // records this execution as ERROR (exit 2) instead of misclassifying a
      // resource explosion as REGRESSION (exit 1).
      throw err;
    }
    // Uncompilable pattern: preserve the historical failed-result contract
    // of the direct evaluator API (suite loading already rejects these at
    // config time with a precise message).
    const message = err instanceof Error ? err.message : String(err);
    return {
      assertion: { type: "regex", pattern, flags },
      passed: false,
      message: message.startsWith("Invalid regex:")
        ? message
        : `Invalid regex: ${message}`,
    };
  }
  return {
    assertion: { type: "regex", pattern, flags },
    passed,
    message: passed
      ? `Regex matched: /${pattern}/${flags ?? ""}`
      : `Regex did not match: /${pattern}/${flags ?? ""}`,
  };
}

/**
 * Minimal JSON-schema subset:
 * - valid JSON
 * - type object
 * - required keys
 * - properties.<name>.const / .enum against PARSED values
 */
function evaluateJsonSchema(
  output: ModelOutput,
  schema: Record<string, unknown>
): AssertionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.text.replace(/^\uFEFF/, ""));
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
      // Object.hasOwn: `key in obj` hits the prototype chain, so inherited keys
      // like "constructor"/"__proto__" falsely satisfied required-key checks.
      if (!Object.hasOwn(obj, key)) {
        return {
          assertion: { type: "json_schema", schema },
          passed: false,
          message: `Missing required key: "${key}"`,
        };
      }
    }
  }

  if (
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties) &&
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed)
  ) {
    const obj = parsed as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;

    for (const [propName, propSchema] of Object.entries(props)) {
      if (!propSchema || typeof propSchema !== "object" || Array.isArray(propSchema)) {
        continue;
      }
      const ps = propSchema as Record<string, unknown>;

      if ("const" in ps) {
        if (!Object.hasOwn(obj, propName) || obj[propName] !== ps.const) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Property "${propName}" expected const ${JSON.stringify(ps.const)}, got ${JSON.stringify(obj[propName])}`,
          };
        }
      }

      if ("enum" in ps) {
        if (!Array.isArray(ps.enum)) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Property "${propName}" has invalid enum (must be an array)`,
          };
        }
        if (!Object.hasOwn(obj, propName) || !ps.enum.includes(obj[propName])) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Property "${propName}" value ${JSON.stringify(obj[propName])} not in enum ${JSON.stringify(ps.enum)}`,
          };
        }
      }
    }
  }

  return {
    assertion: { type: "json_schema", schema },
    passed: true,
    message: "JSON schema checks passed",
  };
}

export function evaluateAssertion(
  assertion: Assertion,
  output: ModelOutput
): AssertionResult {
  switch (assertion.type) {
    case "required":
      return evaluateRequired(
        output,
        assertion.value,
        assertion.caseSensitive !== false
      );
    case "forbidden":
      return evaluateForbidden(
        output,
        assertion.value,
        assertion.caseSensitive !== false
      );
    case "regex":
      return evaluateRegex(output, assertion.pattern, assertion.flags);
    case "json_schema":
      return evaluateJsonSchema(output, assertion.schema);
    default: {
      const _exhaustive: never = assertion;
      return {
        assertion: _exhaustive,
        passed: false,
        message: `Unknown assertion type`,
      };
    }
  }
}

export function evaluateAssertions(
  assertions: Assertion[],
  output: ModelOutput
): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, output));
}
