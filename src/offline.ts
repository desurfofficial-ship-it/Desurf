/**
 * Offline suite loader.
 * Reads suite.json and resolves relative paths to absolute paths.
 * Rejects unknown assertion fields so misconfigured contracts cannot silently pass.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
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
};

type RawSuite = {
  name: string;
  cases: RawCase[];
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

export function parseAssertion(raw: RawAssertion): Assertion {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
    throw new Error(`Assertion must be an object with a string "type"`);
  }

  assertNoUnknownFields(raw);

  switch (raw.type) {
    case "required":
      if (typeof raw.value !== "string" || raw.value === "") {
        throw new Error(`required assertion needs a non-empty string "value"`);
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
      if (typeof raw.value !== "string" || raw.value === "") {
        throw new Error(`forbidden assertion needs a non-empty string "value"`);
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
      try {
        new RegExp(raw.pattern, raw.flags ?? "");
      } catch (err) {
        throw new Error(
          `Invalid regex pattern /${raw.pattern}/${raw.flags ?? ""}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return { type: "regex", pattern: raw.pattern, flags: raw.flags };
    case "json_schema":
      if (!raw.schema || typeof raw.schema !== "object" || Array.isArray(raw.schema)) {
        throw new Error(`json_schema assertion needs an object "schema"`);
      }
      if (
        "required" in raw.schema &&
        (!Array.isArray(raw.schema.required) ||
          !raw.schema.required.every((k) => typeof k === "string"))
      ) {
        throw new Error(`json_schema "required" must be an array of strings`);
      }
      if (
        "properties" in raw.schema &&
        (typeof raw.schema.properties !== "object" ||
          raw.schema.properties === null ||
          Array.isArray(raw.schema.properties))
      ) {
        throw new Error(`json_schema "properties" must be an object`);
      }
      if (
        "type" in raw.schema &&
        typeof raw.schema.type !== "string" &&
        !Array.isArray(raw.schema.type)
      ) {
        throw new Error(`json_schema "type" must be a string or array of strings`);
      }
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
  let raw: RawSuite;
  try {
    raw = JSON.parse(rawText) as RawSuite;
  } catch {
    throw new Error(`Invalid JSON in suite file: ${suiteFile}`);
  }

  if (!raw || typeof raw !== "object" || !raw.name || !Array.isArray(raw.cases)) {
    throw new Error(`Suite must have "name" and "cases" array: ${suiteFile}`);
  }

  if (raw.cases.length === 0) {
    throw new Error(`Suite contains no test cases (empty cases array): ${suiteFile}`);
  }

  const seenIds = new Set<string>();

  const cases: TestCase[] = raw.cases.map((c) => {
    if (!c.id || !c.input || !c.prompt || !c.output || !Array.isArray(c.assertions)) {
      throw new Error(
        `Each case needs id, input, prompt, output, assertions (case: ${c.id ?? "?"})`
      );
    }

    if (seenIds.has(c.id)) {
      throw new Error(`Duplicate test case ID "${c.id}" found in suite: ${suiteFile}`);
    }
    seenIds.add(c.id);

    if (c.assertions.length === 0) {
      throw new Error(`Test case "${c.id}" must contain at least one assertion (empty assertions array).`);
    }

    return {
      id: c.id,
      input: resolvePath(rootDir, c.input),
      prompt: resolvePath(rootDir, c.prompt),
      outputPath: resolvePath(rootDir, c.output),
      assertions: c.assertions.map(parseAssertion),
    };
  });

  return {
    name: raw.name,
    rootDir,
    cases,
  };
}
