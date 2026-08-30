/**
 * Offline cassette sealing.
 *
 * Establishes provenance metadata for existing saved outputs without calling
 * a provider. Hashes the current input+prompt and writes a `.desurf` sidecar.
 */

import { access, constants, readFile, stat } from "node:fs/promises";
import { loadSuite } from "./offline.js";
import { metaPathFor, writeCassetteMeta } from "./fingerprint.js";
import type { Suite, TestCase } from "./types.js";

export type SealOptions = {
  suitePath: string;
  caseId?: string;
  force?: boolean;
};

export type SealCaseResult = {
  caseId: string;
  status: "sealed" | "skipped" | "error";
  message: string;
};

export type SealSummary = {
  suiteName: string;
  results: SealCaseResult[];
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function sealOne(
  testCase: TestCase,
  force: boolean
): Promise<SealCaseResult> {
  try {
    if (!(await isNonEmptyFile(testCase.outputPath))) {
      return {
        caseId: testCase.id,
        status: "error",
        message: `Missing or empty output file: ${testCase.outputPath}`,
      };
    }

    const metaFile = metaPathFor(testCase.outputPath);
    const metaExists = await fileExists(metaFile);

    if (metaExists && !force) {
      return {
        caseId: testCase.id,
        status: "skipped",
        message: `Metadata already exists (use --force to overwrite): ${metaFile}`,
      };
    }

    const [inputText, promptText] = await Promise.all([
      readFile(testCase.input, "utf8"),
      readFile(testCase.prompt, "utf8"),
    ]);

    await writeCassetteMeta(testCase.outputPath, inputText, promptText, "seal");

    return {
      caseId: testCase.id,
      status: "sealed",
      message: `Sealed cassette metadata → ${metaFile}`,
    };
  } catch (err) {
    return {
      caseId: testCase.id,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sealSuite(options: SealOptions): Promise<SealSummary> {
  const suite: Suite = await loadSuite(options.suitePath);
  let cases = suite.cases;

  if (options.caseId) {
    cases = cases.filter((c) => c.id === options.caseId);
    if (cases.length === 0) {
      throw new Error(
        `No test case with id "${options.caseId}" in suite "${suite.name}"`
      );
    }
  }

  const results: SealCaseResult[] = [];
  for (const c of cases) {
    results.push(await sealOne(c, options.force === true));
  }

  return {
    suiteName: suite.name,
    results,
  };
}
