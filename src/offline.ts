/**
 * Offline suite loader.
 * Reads suite.json and resolves relative paths to absolute paths.
 * Rejects unknown assertion fields so misconfigured contracts cannot silently pass.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, isAbsolute, relative, sep } from "node:path";
import type { Assertion, Suite, TestCase, TurnDef } from "./types.js";

type RawAssertion = {
  type: string;
  value?: string;
  pattern?: string;
  flags?: string;
  schema?: Record<string, unknown>;
  caseSensitive?: boolean;
  [key: string]: unknown;
};

type RawSuite = {
  name?: unknown;
  cases?: unknown;
};

const ALLOWED_FIELDS: Record<string, Set<string>> = {
  required: new Set(["type", "value", "caseSensitive"]),
  forbidden: new Set(["type", "value", "caseSensitive"]),
  regex: new Set(["type", "pattern", "flags"]),
  json_schema: new Set(["type", "schema", "allowFences"]),
  max_diff_lines: new Set(["type", "value"]),
  json_path: new Set(["type", "path", "equals", "oneOf", "min", "max"]),
};

const SUPPORTED_PROPERTY_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/**
 * Deliberately minimal JSON Schema vocabulary supported by Desurf.
 * Unknown / misspelled keys at any nesting level are rejected at load time
 * so a typo cannot silently weaken a behavioral contract (false GREEN).
 */
const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "required",
  "properties",
  "const",
  "enum",
  "items",
]);

function assertNoUnknownFields(raw: RawAssertion): void {
  const allowed = ALLOWED_FIELDS[raw.type];
  if (!allowed) {
    return;
  }
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown field(s) on "${raw.type}" assertion: ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
        `Allowed fields: ${[...allowed].join(", ")}`
    );
  }
}

/**
 * Validate the supported json_schema subset at load time so unsupported or
 * malformed schema fragments fail fast (exit 2) instead of silently becoming
 * no-op assertions that pass anything (silent-green).
 *
 * v0.4.3: property-level "type" is now enforced (string/number/integer/
 * boolean/object/array/null, recursively for nested objects). Unknown or
 * unsupported property types are rejected here so a schema typo cannot
 * silently disable the check (false PASS).
 */
function assertNoUnknownSchemaKeys(
  schema: Record<string, unknown>,
  pathLabel: string
): void {
  const unknown = Object.keys(schema).filter((k) => !SUPPORTED_SCHEMA_KEYS.has(k));
  if (unknown.length > 0) {
    throw new Error(
      `json_schema: unsupported or unknown keyword(s) at ${pathLabel}: ${unknown
        .map((k) => `"${k}"`)
        .join(", ")}. ` +
        `Supported keywords: ${[...SUPPORTED_SCHEMA_KEYS].join(", ")}`
    );
  }
}

function validateJsonSchemaShape(schema: Record<string, unknown>): void {
  assertNoUnknownSchemaKeys(schema, "schema root");

  if (schema.type !== undefined && schema.type !== "object") {
    throw new Error(
      `json_schema: unsupported type "${String(schema.type)}" (only "object" is supported)`
    );
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) {
      throw new Error(
        `json_schema: "required" must be an array of strings (got ${typeof schema.required})`
      );
    }
    for (const key of schema.required) {
      if (typeof key !== "string") {
        throw new Error(
          `json_schema: "required" entries must be strings (got ${typeof key})`
        );
      }
    }
  }
  if (schema.properties !== undefined) {
    if (
      typeof schema.properties !== "object" ||
      schema.properties === null ||
      Array.isArray(schema.properties)
    ) {
      throw new Error(`json_schema: "properties" must be an object`);
    }
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (!propSchema || typeof propSchema !== "object" || Array.isArray(propSchema)) {
        throw new Error(
          `json_schema: property "${propName}" must be an object`
        );
      }
      const ps = propSchema as Record<string, unknown>;
      validatePropertySchema(ps, propName);
    }
  }
}

/**
 * Validate one property schema (and, recursively, nested object properties
 * and array item schemas). Shared by the top-level properties pass and the
 * nested traversal so unsupported types fail at load time everywhere.
 */
function validatePropertySchema(
  ps: Record<string, unknown>,
  propName: string
): void {
  assertNoUnknownSchemaKeys(ps, `property "${propName}"`);
  if ("type" in ps) {
    if (
      typeof ps.type !== "string" ||
      !SUPPORTED_PROPERTY_TYPES.has(ps.type)
    ) {
      throw new Error(
        `json_schema: property "${propName}" has unsupported type ${JSON.stringify(
          ps.type
        )} (supported: string, number, integer, boolean, object, array, null)`
      );
    }
  }
  if ("const" in ps && (typeof ps.const === "object" || ps.const === null)) {
    throw new Error(
      `json_schema: property "${propName}" const must be a primitive (objects/arrays compare by reference and can never match parsed JSON)`
    );
  }
  if ("enum" in ps) {
    if (!Array.isArray(ps.enum)) {
      throw new Error(
        `json_schema: property "${propName}" enum must be an array`
      );
    }
    if (ps.enum.some((v) => typeof v === "object" && v !== null)) {
      throw new Error(
        `json_schema: property "${propName}" enum entries must be primitives (objects/arrays compare by reference)`
      );
    }
  }
  if (ps.type === "object") {
    if (ps.properties !== undefined) {
      if (
        typeof ps.properties !== "object" ||
        ps.properties === null ||
        Array.isArray(ps.properties)
      ) {
        throw new Error(
          `json_schema: property "${propName}" "properties" must be an object`
        );
      }
      for (const [nestedName, nestedSchema] of Object.entries(ps.properties)) {
        if (!nestedSchema || typeof nestedSchema !== "object" || Array.isArray(nestedSchema)) {
          throw new Error(
            `json_schema: property "${propName}.${nestedName}" must be an object`
          );
        }
        validatePropertySchema(nestedSchema as Record<string, unknown>, `${propName}.${nestedName}`);
      }
    }
    if (ps.required !== undefined) {
      if (!Array.isArray(ps.required)) {
        throw new Error(
          `json_schema: property "${propName}" "required" must be an array of strings`
        );
      }
      for (const key of ps.required) {
        if (typeof key !== "string") {
          throw new Error(
            `json_schema: property "${propName}" "required" entries must be strings`
          );
        }
      }
    }
  }
  if (ps.type === "array" && ps.items !== undefined) {
    if (typeof ps.items !== "object" || ps.items === null || Array.isArray(ps.items)) {
      throw new Error(
        `json_schema: property "${propName}" "items" must be an object (single-schema form)`
      );
    }
    validatePropertySchema(ps.items as Record<string, unknown>, `${propName}[].items`);
  }
}


/** Validate json_path syntax at load time (malformed → config error). */
function assertValidJsonPathSyntax(path: string): void {
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p === "$") return;
  if (p.length === 0) throw new Error(`json_path "path" is empty`);
  // Reject empty segments, trailing dots, non-numeric brackets, unclosed brackets.
  if (p.includes("..") || p.endsWith(".") || p.startsWith(".") || p.startsWith("[")) {
    throw new Error(`json_path malformed path: "${path}"`);
  }
  let i = 0;
  while (i < p.length) {
    if (p[i] === ".") {
      i++;
      if (i >= p.length || p[i] === "." || p[i] === "[") {
        throw new Error(`json_path malformed path: "${path}"`);
      }
      continue;
    }
    if (p[i] === "[") {
      const close = p.indexOf("]", i);
      if (close < 0) throw new Error(`json_path malformed path: "${path}"`);
      const idx = p.slice(i + 1, close);
      if (!/^\d+$/.test(idx)) throw new Error(`json_path malformed path: "${path}"`);
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < p.length && p[j] !== "." && p[j] !== "[") j++;
    const key = p.slice(i, j);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`json_path malformed path: "${path}"`);
    }
    i = j;
  }
}

export function parseAssertion(raw: RawAssertion): Assertion {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
    throw new Error(`Assertion must be an object with a string "type"`);
  }

  assertNoUnknownFields(raw);

  switch (raw.type) {
    case "required":
      if (typeof raw.value !== "string") {
        throw new Error(`required assertion needs a string "value"`);
      }
      if (raw.value.length === 0) {
        throw new Error(
          `required assertion needs a non-empty "value" (an empty string matches every output — vacuously green)`
        );
      }
      if (
        raw.caseSensitive !== undefined &&
        typeof raw.caseSensitive !== "boolean"
      ) {
        throw new Error(`required assertion "caseSensitive" must be a boolean`);
      }
      return {
        type: "required",
        value: raw.value,
        caseSensitive: raw.caseSensitive,
      };
    case "forbidden":
      if (typeof raw.value !== "string") {
        throw new Error(`forbidden assertion needs a string "value"`);
      }
      if (raw.value.length === 0) {
        throw new Error(
          `forbidden assertion needs a non-empty "value" (an empty string is contained in every output — can never pass)`
        );
      }
      if (
        raw.caseSensitive !== undefined &&
        typeof raw.caseSensitive !== "boolean"
      ) {
        throw new Error(
          `forbidden assertion "caseSensitive" must be a boolean`
        );
      }
      return {
        type: "forbidden",
        value: raw.value,
        caseSensitive: raw.caseSensitive,
      };
    case "regex":
      if (typeof raw.pattern !== "string") {
        throw new Error(`regex assertion needs a string "pattern"`);
      }
      if (raw.flags !== undefined && typeof raw.flags !== "string") {
        throw new Error(`regex assertion "flags" must be a string`);
      }
      // Compile NOW: an invalid pattern/flags combination is a configuration
      // error and must fail the run with exit 2 before anything executes.
      // Previously it surfaced per-execution as REGRESSION (exit 1), misclassifying
      // broken config as a model behavior change.
      try {
        new RegExp(raw.pattern, raw.flags ?? "");
      } catch (err) {
        throw new Error(
          `regex assertion has an invalid /${raw.pattern}/${raw.flags ?? ""}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      return { type: "regex", pattern: raw.pattern, flags: raw.flags };
    case "json_schema":
      if (!raw.schema || typeof raw.schema !== "object" || Array.isArray(raw.schema)) {
        throw new Error(`json_schema assertion needs an object "schema"`);
      }
      validateJsonSchemaShape(raw.schema);
      if (raw.allowFences !== undefined && typeof raw.allowFences !== "boolean") {
        throw new Error(
          `json_schema: "allowFences" must be a boolean (got ${typeof raw.allowFences})`
        );
      }
      return {
        type: "json_schema",
        schema: raw.schema,
        ...(raw.allowFences !== undefined ? { allowFences: raw.allowFences as boolean } : {}),
      };
    case "max_diff_lines": {
      if (typeof raw.value !== "number" || !Number.isInteger(raw.value) || raw.value < 0) {
        throw new Error(
          `max_diff_lines "value" must be an integer ≥ 0 (got ${JSON.stringify(raw.value)})`
        );
      }
      return { type: "max_diff_lines", value: raw.value };
    }
    case "json_path": {
      if (typeof raw.path !== "string" || raw.path.trim().length === 0) {
        throw new Error(`json_path assertion needs a non-empty string "path"`);
      }
      assertValidJsonPathSyntax(raw.path);
      const hasEquals = Object.hasOwn(raw, "equals");
      const hasOneOf = Object.hasOwn(raw, "oneOf");
      const hasMin = Object.hasOwn(raw, "min");
      const hasMax = Object.hasOwn(raw, "max");
      const groups = [hasEquals, hasOneOf, hasMin || hasMax].filter(Boolean).length;
      if (groups === 0) {
        throw new Error(
          `json_path needs exactly one comparison: equals, oneOf, or min/max`
        );
      }
      if (groups > 1) {
        throw new Error(
          `json_path comparison fields are mutually exclusive (equals | oneOf | min/max)`
        );
      }
      if (hasOneOf) {
        if (!Array.isArray(raw.oneOf) || (raw.oneOf as unknown[]).length === 0) {
          throw new Error(`json_path "oneOf" must be a non-empty array`);
        }
      }
      if (hasMin && typeof raw.min !== "number") {
        throw new Error(`json_path "min" must be a number`);
      }
      if (hasMax && typeof raw.max !== "number") {
        throw new Error(`json_path "max" must be a number`);
      }
      const out: {
        type: "json_path";
        path: string;
        equals?: unknown;
        oneOf?: unknown[];
        min?: number;
        max?: number;
      } = { type: "json_path", path: raw.path };
      if (hasEquals) out.equals = raw.equals;
      if (hasOneOf) out.oneOf = raw.oneOf as unknown[];
      if (hasMin) out.min = raw.min as number;
      if (hasMax) out.max = raw.max as number;
      return out;
    }
    default:
      throw new Error(`Unknown assertion type: "${raw.type}"`);
  }
}

/**
 * Resolve a case path (input / prompt / output) under the suite root and
 * refuse anything that escapes it.
 *
 * suite.json is data — often contributed via pull request — and data does
 * not get to name files outside its own suite. The previous resolver
 * passed absolute paths through verbatim (`"output": "/etc/passwd"`
 * read an arbitrary file, and the failing-case preview then printed its
 * contents into the CI log) and happily followed `"output": "../../.."`
 * anywhere on disk. Both are now hard load errors (exit 2).
 *
 * The jail is lexical: a symlink placed inside the suite by the suite's
 * own author can still point elsewhere. That is an explicit on-disk
 * action by someone who already controls the checkout — out of scope
 * here, same boundary most build-tool sandboxes draw.
 *
 * Self-clobber guard: a case `"output": "suite.json"` (or any path that
 * resolves to the suite file) is rejected. A successful `desurf record`
 * against such a case would `writeFile(suite.json, modelOutput)`,
 * destroying the suite definition the very next load. The input/prompt
 * fields are likewise refused from naming suite.json — reading the suite
 * file as "input" leaks the suite structure into the model output and
 * is never the author's intent.
 */
function resolveCasePath(
  rootDir: string,
  p: string,
  field: string,
  caseId: string,
  suiteFile: string
): string {
  if (isAbsolute(p)) {
    throw new Error(
      `Case "${caseId}" field "${field}" must be a path relative to the suite directory, got absolute path: ${p}. ` +
        `Absolute paths let a suite read files anywhere on disk.`
    );
  }
  const resolved = resolve(rootDir, p);
  const rel = relative(rootDir, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(
      `Case "${caseId}" field "${field}" escapes the suite directory: ${p} (resolves to ${resolved}). ` +
        `Case files must live under the suite root.`
    );
  }
  if (resolved === suiteFile) {
    throw new Error(
      `Case "${caseId}" field "${field}" must not name the suite file itself: ${p} (resolves to ${suiteFile}). ` +
        `Recording would overwrite suite.json with model output and destroy the suite.`
    );
  }
  return resolved;
}

export async function loadSuite(suitePath: string): Promise<Suite> {
  const absolute = resolve(suitePath);
  let suiteFile: string;
  let rootDir: string;

  try {
    const s = await stat(absolute);
    if (s.isDirectory()) {
      rootDir = absolute;
      suiteFile = resolve(rootDir, "suite.json");
    } else {
      suiteFile = absolute;
      rootDir = dirname(absolute);
    }
  } catch {
    if (absolute.endsWith(".json")) {
      suiteFile = absolute;
      rootDir = dirname(absolute);
    } else {
      rootDir = absolute;
      suiteFile = resolve(rootDir, "suite.json");
    }
  }

  try {
    const s = await stat(suiteFile);
    if (s.isDirectory()) {
      throw new Error(`Suite file is a directory, not a JSON file: ${suiteFile}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Suite file not found: ${suiteFile}`);
    }
    throw err;
  }

  const rawText = (await readFile(suiteFile, "utf8")).replace(/^\uFEFF/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    throw new Error(`Invalid JSON in suite file: ${suiteFile}`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Suite file must contain a JSON object: ${suiteFile}`
    );
  }

  const rawObj = raw as RawSuite;

  if (
    typeof rawObj.name !== "string" ||
    rawObj.name.length === 0 ||
    !Array.isArray(rawObj.cases)
  ) {
    throw new Error(
      `Suite must have a non-empty string "name" and "cases" array: ${suiteFile}`
    );
  }

  // An empty suite evaluates to PASS by definition — a green gate over zero
  // contracts. For a regression gate this must be a configuration error.
  if (rawObj.cases.length === 0) {
    throw new Error(
      `Suite has no test cases (${suiteFile}). An empty suite gates nothing — add a case or delete the suite.`
    );
  }

  const seenIds = new Set<string>();

  const cases: TestCase[] = rawObj.cases.map((c: any) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new Error(
        `Each case must be a JSON object (in ${suiteFile})`
      );
    }
    // `c.id` must be a non-empty string. JSON lets you write `"id": 123`
    // (number) or `"id": true` (boolean); a non-string id silently loads
    // (the case "runs" as case id `123`) but can never be selected via
    // `--case <id>`, since the CLI always passes a string and
    // `c.id === options.caseId` compares number-vs-string. Reject loudly
    // at load time so authors discover the typo before CI does.
    if (typeof c.id !== "string" || c.id.length === 0) {
      throw new Error(
        `Each case needs a non-empty string "id" (got ${JSON.stringify(c.id)}). ` +
          `Numeric or boolean ids cannot be selected with --case and break report correlation.`
      );
    }
    if (typeof c.prompt !== "string" || c.prompt.length === 0) {
      throw new Error(
        `Case "${c.id}" field "prompt" must be a non-empty string (got ${JSON.stringify(c.prompt)})`
      );
    }
    if (typeof c.output !== "string" || c.output.length === 0) {
      throw new Error(
        `Case "${c.id}" field "output" must be a non-empty string (got ${JSON.stringify(c.output)})`
      );
    }
    if (!Array.isArray(c.assertions)) {
      throw new Error(
        `Case "${c.id}" field "assertions" must be an array (got ${typeof c.assertions})`
      );
    }
    if (seenIds.has(c.id)) {
      throw new Error(
        `Duplicate test case id "${c.id}" in ${suiteFile} — case ids must be unique (--case selection and reporting are ambiguous otherwise)`
      );
    }
    seenIds.add(c.id);

    const hasTurns = c.turns !== undefined;
    const hasInput = c.input !== undefined && c.input !== null && c.input !== "";

    if (hasTurns && hasInput) {
      throw new Error(
        `Case "${c.id}" has both "input" and "turns" — they are mutually exclusive (exit 2). ` +
          `Use "input" for single-turn cases, or "turns" for multi-turn conversations.`
      );
    }

    let turns: TurnDef[] | undefined;
    if (hasTurns) {
      if (!Array.isArray(c.turns)) {
        throw new Error(
          `Case "${c.id}" field "turns" must be an array (got ${typeof c.turns})`
        );
      }
      if (c.turns.length === 0) {
        throw new Error(
          `Case "${c.id}" field "turns" must have 1–20 entries (got 0)`
        );
      }
      if (c.turns.length > 20) {
        throw new Error(
          `Case "${c.id}" field "turns" exceeds the 20-turn cap (got ${c.turns.length})`
        );
      }
      if (!String(c.output).endsWith(".json")) {
        throw new Error(
          `Case "${c.id}" uses "turns" but output "${c.output}" does not end in .json ` +
            `(transcript cassette required)`
        );
      }
      const TURN_ALLOWED = new Set(["user", "assertions"]);
      turns = c.turns.map((rawTurn: unknown, ti: number) => {
        if (rawTurn === null || typeof rawTurn !== "object" || Array.isArray(rawTurn)) {
          throw new Error(`Case "${c.id}" turns[${ti}] must be an object`);
        }
        const tr = rawTurn as Record<string, unknown>;
        const unknown = Object.keys(tr).filter((k) => !TURN_ALLOWED.has(k));
        if (unknown.length > 0) {
          throw new Error(
            `Case "${c.id}" turns[${ti}] has unknown field(s): ${unknown.map((k) => `"${k}"`).join(", ")}. ` +
              `Allowed: user, assertions`
          );
        }
        if (typeof tr.user !== "string" || tr.user.length === 0) {
          throw new Error(
            `Case "${c.id}" turns[${ti}].user must be a non-empty path string`
          );
        }
        let turnAssertions: Assertion[] | undefined;
        if (tr.assertions !== undefined) {
          if (!Array.isArray(tr.assertions)) {
            throw new Error(
              `Case "${c.id}" turns[${ti}].assertions must be an array`
            );
          }
          turnAssertions = tr.assertions.map((a: unknown) =>
            parseAssertion(a as RawAssertion)
          );
        }
        return {
          user: resolveCasePath(rootDir, tr.user, "user", c.id, suiteFile),
          assertions: turnAssertions,
        };
      });
    } else {
      if (typeof c.input !== "string" || c.input.length === 0) {
        throw new Error(
          `Case "${c.id}" field "input" must be a non-empty string (got ${JSON.stringify(c.input)})`
        );
      }
    }

    const assertions = c.assertions.map((a: unknown) =>
      parseAssertion(a as RawAssertion)
    );
    const turnAssertionCount = (turns ?? []).reduce(
      (n, tr) => n + (tr.assertions?.length ?? 0),
      0
    );
    if (assertions.length === 0 && turnAssertionCount === 0) {
      throw new Error(
        `Case "${c.id}" has no assertions. A contract with zero assertions passes any output — add at least one assertion.`
      );
    }

    const result: TestCase = {
      id: c.id,
      prompt: resolveCasePath(rootDir, c.prompt, "prompt", c.id, suiteFile),
      outputPath: resolveCasePath(rootDir, c.output, "output", c.id, suiteFile),
      assertions,
    };
    if (turns) {
      result.turns = turns;
    } else {
      result.input = resolveCasePath(rootDir, c.input, "input", c.id, suiteFile);
    }
    return result;
  });

  return {
    name: rawObj.name,
    rootDir,
    cases,
  };
}
