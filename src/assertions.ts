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

const TYPE_MESSAGES: Record<string, string> = {
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "a boolean",
  object: "an object",
  array: "an array",
  null: "null",
};

/**
 * Check a parsed JSON value against a supported property type.
 * Returns an error message when the value does not match, or null.
 *
 * Supports the minimal, intentional subset: string, number, integer,
 * boolean, object, array, null. `number` accepts any JSON number;
 * `integer` additionally rejects fractional values (1.5) and the
 * JSON-parse artifact of 1.0 (parsed as 1) is accepted as an integer,
 * mirroring JavaScript's numeric model. Nested objects are validated
 * recursively through their own `properties` (and required/const/enum
 * of the nested schema).
 */
function checkPropertyType(
  value: unknown,
  propSchema: Record<string, unknown>,
  propName: string,
  path: string
): string | null {
  const expected = propSchema.type;
  if (expected === undefined) return null;

  const typePath = path ? `${path}.${propName}` : propName;

  if (expected === "null") {
    if (value !== null) {
      return `Property "${typePath}" expected null, got ${JSON.stringify(value)}`;
    }
    return null;
  }

  if (value === null) {
    return `Property "${typePath}" expected ${TYPE_MESSAGES[String(expected)] ?? String(expected)}, got null`;
  }

  const actual = typeof value;

  if (expected === "array") {
    if (!Array.isArray(value)) {
      return `Property "${typePath}" expected an array, got ${actual}`;
    }
    return checkNestedProperties(value, propSchema, typePath);
  }

  if (expected === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      return `Property "${typePath}" expected an object, got ${actual}`;
    }
    return checkNestedProperties(value, propSchema, typePath);
  }

  if (expected === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return `Property "${typePath}" expected an integer, got ${JSON.stringify(value)}`;
    }
    return null;
  }

  if (expected === "number") {
    if (typeof value !== "number") {
      return `Property "${typePath}" expected a number, got ${JSON.stringify(value)}`;
    }
    return null;
  }

  if (expected === "boolean" || expected === "string") {
    if (actual !== expected) {
      return `Property "${typePath}" expected ${TYPE_MESSAGES[expected]}, got ${JSON.stringify(value)}`;
    }
    return null;
  }

  // Unsupported type strings are rejected at suite load time; this is a
  // defensive fallback for programmatically-constructed schemas.
  return `Property "${typePath}" has unsupported type "${String(expected)}"`;
}

/**
 * Validate nested properties (object/array element schemas).
 * Objects: required keys, const, enum, and recursive type checks.
 * Arrays: element-level `items.type` checks when the item schema is a
 * plain object (single-schema form). This keeps the subset minimal.
 */
function checkNestedProperties(
  value: unknown,
  propSchema: Record<string, unknown>,
  path: string
): string | null {
  if (Array.isArray(value)) {
    const items = propSchema.items;
    if (
      items &&
      typeof items === "object" &&
      !Array.isArray(items) &&
      typeof (items as Record<string, unknown>).type === "string"
    ) {
      const itemSchema = items as Record<string, unknown>;
      for (let i = 0; i < value.length; i++) {
        const err = checkPropertyType(value[i], itemSchema, `[${i}]`, path);
        if (err) return err;
      }
    }
    return null;
  }

  const obj = value as Record<string, unknown>;

  if (Array.isArray(propSchema.required)) {
    for (const key of propSchema.required) {
      if (typeof key !== "string") continue;
      if (!Object.hasOwn(obj, key)) {
        return `Property "${path}" missing required key: "${key}"`;
      }
    }
  }

  const props = propSchema.properties;
  if (
    props &&
    typeof props === "object" &&
    !Array.isArray(props) &&
    obj !== null &&
    typeof obj === "object"
  ) {
    const entries = Object.entries(props as Record<string, unknown>);
    for (const [propName, subSchema] of entries) {
      if (!subSchema || typeof subSchema !== "object" || Array.isArray(subSchema)) {
        continue;
      }
      const sub = subSchema as Record<string, unknown>;

      if (!Object.hasOwn(obj, propName)) {
        // Missing optional property: only required/const/enum care. const
        // implies presence (a missing const property must fail), enum too.
        if ("const" in sub) {
          return `Property "${path}.${propName}" expected const ${JSON.stringify(sub.const)}, got undefined`;
        }
        if ("enum" in sub && Array.isArray(sub.enum)) {
          return `Property "${path}.${propName}" value undefined not in enum ${JSON.stringify(sub.enum)}`;
        }
        continue;
      }

      if ("const" in sub) {
        if (obj[propName] !== sub.const) {
          return `Property "${path}.${propName}" expected const ${JSON.stringify(sub.const)}, got ${JSON.stringify(obj[propName])}`;
        }
      }

      if ("enum" in sub) {
        if (!Array.isArray(sub.enum)) {
          return `Property "${path}.${propName}" has invalid enum (must be an array)`;
        }
        if (!sub.enum.includes(obj[propName])) {
          return `Property "${path}.${propName}" value ${JSON.stringify(obj[propName])} not in enum ${JSON.stringify(sub.enum)}`;
        }
      }

      const err = checkPropertyType(obj[propName], sub, propName, path);
      if (err) return err;
    }
  }

  return null;
}

/**
 * Minimal JSON-schema subset:
 * - valid JSON
 * - type object
 * - required keys
 * - properties.<name>.const / .enum against PARSED values
 * - properties.<name>.type enforcement (string/number/integer/boolean/
 *   object/array/null), recursively for nested objects
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

      // Property-level type enforcement (P1). A schema violation is a
      // behavioral contract failure: REGRESSION (exit 1), never ERROR.
      if ("type" in ps && typeof ps.type === "string") {
        if (!Object.hasOwn(obj, propName)) {
          // A declared property type does not imply presence: only
          // `required` (and const/enum, handled above) demand the key.
          continue;
        }
        const err = checkPropertyType(obj[propName], ps, propName, "");
        if (err) {
          return {
            assertion: { type: "json_schema", schema },
            passed: false,
            message: err,
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
