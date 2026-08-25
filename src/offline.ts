/**
 * Offline suite loader.
 * Reads suite.json and resolves relative paths to absolute paths.
 * Rejects unknown assertion fields so misconfigured contracts cannot silently pass.
 */

import { readFile } from "node:fs/promises";
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
      return { type: "regex", pattern: raw.pattern, flags: raw.flags };
    case "json_schema":
      if (!raw.schema || typeof raw.schema !== "object" || Array.isArray(raw.schema)) {
        throw new Error(`json_schema assertion needs an object "schema"`);
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

  if (!raw.name || !Array.isArray(raw.cases)) {
    throw new Error(`Suite must have "name" and "cases" array: ${suiteFile}`);
  }

  const cases: TestCase[] = raw.cases.map((c) => {
    if (!c.id || !c.input || !c.prompt || !c.output || !Array.isArray(c.assertions)) {
      throw new Error(
        `Each case needs id, input, prompt, output, assertions (case: ${c.id ?? "?"})`
      );
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
