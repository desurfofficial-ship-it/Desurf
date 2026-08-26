/**
 * Assertion evaluation.
 * Pure functions — no I/O, no CLI, no provider knowledge.
 */

import type { Assertion, AssertionResult, ModelOutput } from "./types.js";

/** Keywords supported in the Desurf json_schema dialect (top-level). */
export const JSON_SCHEMA_SUPPORTED_KEYWORDS = [
  "type",
  "required",
  "properties",
  "const",
  "enum",
] as const;

/** Keywords allowed inside a property schema (one level only). */
export const JSON_SCHEMA_PROPERTY_KEYWORDS = ["const", "enum"] as const;

/**
 * Validate that a schema uses only the supported Desurf dialect.
 * Throws a clear Error if unsupported keywords or types are present.
 * Call this at load time so misconfigured contracts never silently pass.
 */
export function validateJsonSchemaDialect(
  schema: Record<string, unknown>,
  path = "schema"
): void {
  const keys = Object.keys(schema);
  const supported = new Set<string>(JSON_SCHEMA_SUPPORTED_KEYWORDS);
  const unsupported = keys.filter((k) => !supported.has(k));
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported json_schema keyword: ${unsupported.map((k) => `"${k}"`).join(", ")}. ` +
        `Supported keywords: ${JSON_SCHEMA_SUPPORTED_KEYWORDS.join(", ")}.`
    );
  }

  if ("type" in schema) {
    if (schema.type !== "object") {
      throw new Error(
        `Unsupported json_schema type: ${JSON.stringify(schema.type)}. ` +
          `Only "object" is supported in the Desurf dialect.`
      );
    }
  }

  if ("required" in schema) {
    if (!Array.isArray(schema.required)) {
      throw new Error(
        `json_schema "required" must be an array of strings (at ${path})`
      );
    }
    for (const item of schema.required) {
      if (typeof item !== "string") {
        throw new Error(
          `json_schema "required" entries must be strings (at ${path})`
        );
      }
    }
  }

  if ("const" in schema || "enum" in schema) {
    throw new Error(
      `Unsupported json_schema keyword at root: ${
        [
          "const" in schema ? '"const"' : null,
          "enum" in schema ? '"enum"' : null,
        ]
          .filter(Boolean)
          .join(", ")
      }. Use properties.<name>.const or properties.<name>.enum instead.`
    );
  }

  if ("properties" in schema) {
    if (
      typeof schema.properties !== "object" ||
      schema.properties === null ||
      Array.isArray(schema.properties)
    ) {
      throw new Error(`json_schema "properties" must be an object (at ${path})`);
    }
    const props = schema.properties as Record<string, unknown>;
    const propAllowed = new Set<string>(JSON_SCHEMA_PROPERTY_KEYWORDS);
    for (const [propName, propSchema] of Object.entries(props)) {
      if (
        !propSchema ||
        typeof propSchema !== "object" ||
        Array.isArray(propSchema)
      ) {
        throw new Error(
          `json_schema properties.${propName} must be an object with supported keywords: ${JSON_SCHEMA_PROPERTY_KEYWORDS.join(", ")}`
        );
      }
      const ps = propSchema as Record<string, unknown>;
      const propKeys = Object.keys(ps);
      const bad = propKeys.filter((k) => !propAllowed.has(k));
      if (bad.length > 0) {
        throw new Error(
          `Unsupported json_schema keyword in properties.${propName}: ${bad.map((k) => `"${k}"`).join(", ")}. ` +
            `Supported property keywords: ${JSON_SCHEMA_PROPERTY_KEYWORDS.join(", ")}.`
        );
      }
      if ("enum" in ps && !Array.isArray(ps.enum)) {
        throw new Error(
          `json_schema properties.${propName}.enum must be an array`
        );
      }
    }
  }
}

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

  const expectsObject =
    schema.type === "object" ||
    "required" in schema ||
    "properties" in schema;

  if (expectsObject) {
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
        if (!(propName in obj) || obj[propName] !== ps.const) {
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
        if (!(propName in obj) || !ps.enum.includes(obj[propName])) {
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
        assertion.caseSensitive === true
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
