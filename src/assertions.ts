/**
 * Assertion evaluation.
 * Pure functions — no I/O, no CLI, no provider knowledge.
 */

import vm from "node:vm";
import type { Assertion, AssertionResult, ModelOutput } from "./types.js";

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
  try {
    const re = new RegExp(pattern, flags ?? "");
    let passed = false;
    try {
      const script = new vm.Script("re.test(text)");
      const context = vm.createContext({ re, text: output.text });
      passed = Boolean(script.runInContext(context, { timeout: 1000 }));
    } catch (vmErr: any) {
      if (
        vmErr &&
        (vmErr.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ||
          String(vmErr.message).includes("timed out"))
      ) {
        return {
          assertion: { type: "regex", pattern, flags },
          passed: false,
          message: `Regex evaluation timed out (potential ReDoS): /${pattern}/${flags ?? ""}`,
        };
      }
      passed = re.test(output.text);
    }
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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || typeof a !== "object" || b === null || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function hasOwnProperty(obj: unknown, key: string): boolean {
  return typeof obj === "object" && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
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
      if (!hasOwnProperty(obj, key)) {
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
        if (!hasOwnProperty(obj, propName)) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Property "${propName}" expected const ${JSON.stringify(ps.const)}, got undefined`,
          };
        }
        const val = obj[propName];
        if (!deepEqual(val, ps.const)) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Property "${propName}" expected const ${JSON.stringify(ps.const)}, got ${JSON.stringify(val)}`,
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
        if (!hasOwnProperty(obj, propName)) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Missing property "${propName}" with value in enum ${JSON.stringify(ps.enum)}`,
          };
        }
        const val = obj[propName];
        const match = ps.enum.some((item) => deepEqual(item, val));
        if (!match) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: `Property "${propName}" value ${JSON.stringify(val)} not in enum ${JSON.stringify(ps.enum)}`,
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
