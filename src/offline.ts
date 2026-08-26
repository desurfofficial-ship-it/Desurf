/**
 * Offline suite loader.
 * Reads suite.json and resolves relative paths to absolute paths.
 * Rejects unknown assertion fields, unsupported json_schema keywords,
 * empty suites, empty assertion lists, and duplicate case IDs so
 * misconfigured contracts cannot silently pass.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { validateJsonSchemaDialect } from "./assertions.js";
import type { Assertion, Suite, TestCase } from "./types.js";

type RawAssertion = {
  type: string;
  value?: string;
  pattern?: string;
  flags?: string;
  schema?: Record<string, unknown>;
  caseSensitive?: boolean;
  [key: string]: unknown;
};

type RawCase = {
  id: string;
  input: string;
  prompt: string;
  output: string;
  assertions: RawAssertion[];
  [key: string]: unknown;
};

type RawSuite = {
  name: string;
  cases: RawCase[];
  [key: string]: unknown;
};

const ALLOWED_FIELDS: Record<string, Set<string>> = {
  required: new Set(["type", "value", "caseSensitive"]),
  forbidden: new Set(["type", "value", "caseSensitive"]),
  regex: new Set(["type", "pattern", "flags"]),
  json_schema: new Set(["type", "schema"]),
};

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

function validateRegexPattern(pattern: string, flags?: string): void {
  try {
    new RegExp(pattern, flags ?? "");
  } catch (err) {
    throw new Error(
      `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)} ` +
        `(pattern: ${JSON.stringify(pattern)}${flags !== undefined ? `, flags: ${JSON.stringify(flags)}` : ""})`
    );
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
      validateRegexPattern(raw.pattern, raw.flags);
      return { type: "regex", pattern: raw.pattern, flags: raw.flags };
    case "json_schema":
      if (!raw.schema || typeof raw.schema !== "object" || Array.isArray(raw.schema)) {
        throw new Error(`json_schema assertion needs an object "schema"`);
      }
      validateJsonSchemaDialect(raw.schema);
      return { type: "json_schema", schema: raw.schema };
    default:
      throw new Error(`Unknown assertion type: "${raw.type}"`);
  }
}

function resolvePath(suiteDir: string, p: string): string {
  return isAbsolute(p) ? p : resolve(suiteDir, p);
}

export async function loadSuite(suitePath: string): Promise<Suite> {
  const absolute = resolve(suitePath);
  let suiteFile: string;
  let rootDir: string;

  if (absolute.endsWith("suite.json")) {
    suiteFile = absolute;
    rootDir = dirname(absolute);
  } else {
    rootDir = absolute;
    suiteFile = resolve(rootDir, "suite.json");
  }

  const rawText = await readFile(suiteFile, "utf8");
  let raw: RawSuite;
  try {
    raw = JSON.parse(rawText) as RawSuite;
  } catch {
    throw new Error(`Invalid JSON in suite file: ${suiteFile}`);
  }

  if (!raw.name || typeof raw.name !== "string") {
    throw new Error(`Suite must have a string "name": ${suiteFile}`);
  }
  if (!Array.isArray(raw.cases)) {
    throw new Error(`Suite must have a "cases" array: ${suiteFile}`);
  }

  if (raw.cases.length === 0) {
    throw new Error(`Suite contains no test cases.`);
  }

  const seenIds = new Set<string>();
  const cases: TestCase[] = [];

  for (const c of raw.cases) {
    if (!c || typeof c !== "object") {
      throw new Error(`Each case must be an object`);
    }
    if (!c.id || typeof c.id !== "string") {
      throw new Error(`Each case needs a string "id"`);
    }
    if (seenIds.has(c.id)) {
      throw new Error(`Duplicate case id: "${c.id}"`);
    }
    seenIds.add(c.id);

    if (!c.input || typeof c.input !== "string") {
      throw new Error(`Case "${c.id}" needs a string "input" path`);
    }
    if (!c.prompt || typeof c.prompt !== "string") {
      throw new Error(`Case "${c.id}" needs a string "prompt" path`);
    }
    if (!c.output || typeof c.output !== "string") {
      throw new Error(`Case "${c.id}" needs a string "output" path`);
    }
    if (!Array.isArray(c.assertions)) {
      throw new Error(`Case "${c.id}" needs an "assertions" array`);
    }
    if (c.assertions.length === 0) {
      throw new Error(
        `Case "${c.id}" has an empty assertions list. A test case without a behavioral contract is a configuration error.`
      );
    }

    let assertions: Assertion[];
    try {
      assertions = c.assertions.map(parseAssertion);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Case "${c.id}": ${msg}`);
    }

    cases.push({
      id: c.id,
      input: resolvePath(rootDir, c.input),
      prompt: resolvePath(rootDir, c.prompt),
      outputPath: resolvePath(rootDir, c.output),
      assertions,
    });
  }

  return {
    name: raw.name,
    rootDir,
    cases,
  };
}
