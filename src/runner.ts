/**
 * Test runner (Stage 1 — single execution, offline only).
 * Orchestrates loader → provider → engine.
 */

import { readFile } from "node:fs/promises";
import { evaluateTestCase } from "./engine.js";
import { loadSuite } from "./offline.js";
import { SavedOutputAdapter } from "./provider.js";
import type { ModelAdapter, Suite, TestCase, TestResult } from "./types.js";

export type RunOptions = {
  suitePath: string;
  caseId?: string;
  provider?: ModelAdapter;
};

export type RunSummary = {
  suiteName: string;
  results: TestResult[];
  passed: number;
  failed: number;
  errors: number;
};

async function runOneCase(
  testCase: TestCase,
  provider: ModelAdapter
): Promise<TestResult> {
  try {
    // Stage 1: we still load input/prompt for completeness,
    // but the provider only needs the saved output path.
    const [inputText, promptText] = await Promise.all([
      readFile(testCase.input, "utf8"),
      readFile(testCase.prompt, "utf8"),
    ]);

    const output = await provider.execute({
      input: inputText,
      prompt: promptText,
      outputPath: testCase.outputPath,
    });

    return evaluateTestCase(testCase, output);
  } catch (err) {
    return {
      caseId: testCase.id,
      passed: false,
      assertionResults: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSuite(options: RunOptions): Promise<RunSummary> {
  const suite: Suite = await loadSuite(options.suitePath);
  const provider = options.provider ?? new SavedOutputAdapter();

  let cases = suite.cases;
  if (options.caseId) {
    cases = cases.filter((c) => c.id === options.caseId);
    if (cases.length === 0) {
      throw new Error(
        `No test case with id "${options.caseId}" in suite "${suite.name}"`
      );
    }
  }

  const results: TestResult[] = [];
  for (const c of cases) {
    results.push(await runOneCase(c, provider));
  }

  const passed = results.filter((r) => r.passed && !r.error).length;
  const errors = results.filter((r) => r.error).length;
  const failed = results.length - passed - errors;

  return {
    suiteName: suite.name,
    results,
    passed,
    failed,
    errors,
  };
}
