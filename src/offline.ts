/**
 * Offline suite loader.
 * Reads suite.json and resolves relative paths to absolute paths.
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

function parseAssertion(raw: RawAssertion): Assertion {
  switch (raw.type) {
    case "required":
      if (typeof raw.value !== "string") {
        throw new Error(`required assertion needs a string "value"`);
      }
      return { type: "required", value: raw.value };
    case "forbidden":
      if (typeof raw.value !== "string") {
        throw new Error(`forbidden assertion needs a string "value"`);
      }
      return { type: "forbidden", value: raw.value };
    case "regex":
      if (typeof raw.pattern !== "string") {
        throw new Error(`regex assertion needs a string "pattern"`);
      }
      return { type: "regex", pattern: raw.pattern, flags: raw.flags };
    case "json_schema":
      if (!raw.schema || typeof raw.schema !== "object") {
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

/**
 * Load a suite from a directory that contains suite.json
 * or from a direct path to suite.json.
 */
export async function loadSuite(suitePath: string): Promise<Suite> {
  const absolute = resolve(suitePath);
  let suiteFile: string;
  let rootDir: string;

  // Accept either a directory or a direct path to suite.json
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
