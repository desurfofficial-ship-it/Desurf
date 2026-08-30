/**
 * Test runner (Stage 2 — supports --repeat N).
 * Orchestrates loader → provider → engine → reliability classifier.
 */

import { readFile } from "node:fs/promises";
import { evaluateTestCase } from "./engine.js";
import { loadSuite } from "./offline.js";
import { assertCassetteFresh, readCassetteState } from "./fingerprint.js";
import { SavedOutputAdapter } from "./provider.js";
import { summarizeCase } from "./repeat.js";
import type {
  CaseReliability,
  ModelAdapter,
  Suite,
  TestCase,
  TestResult,
} from "./types.js";

export type RunOptions = {
  suitePath: string;
  caseId?: string;
  /** Number of times to execute each case. Default 1. */
  repeat?: number;
  provider?: ModelAdapter;
};

export type RunSummary = {
  suiteName: string;
  /** One entry per test case (after all repeats). */
  cases: CaseReliability[];
  passed: number;
  flaky: number;
  regression: number;
  errors: number;
};

async function runOneExecution(
  testCase: TestCase,
  provider: ModelAdapter
): Promise<TestResult> {
  try {
    const [inputText, promptText] = await Promise.all([
      readFile(testCase.input, "utf8"),
      readFile(testCase.prompt, "utf8"),
    ]);

    // Stale-fixture check only applies offline (saved cassette evaluation).
    if (provider instanceof SavedOutputAdapter) {
      await assertCassetteFresh(testCase.outputPath, inputText, promptText);
    }

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
  const repeat = Math.max(1, options.repeat ?? 1);

  let cases = suite.cases;
  if (options.caseId) {
    cases = cases.filter((c) => c.id === options.caseId);
    if (cases.length === 0) {
      throw new Error(
        `No test case with id "${options.caseId}" in suite "${suite.name}"`
      );
    }
  }

  const caseResults: CaseReliability[] = [];

  for (const c of cases) {
    const executions: TestResult[] = [];
    for (let i = 0; i < repeat; i++) {
      executions.push(await runOneExecution(c, provider));
    }
    const reliability = summarizeCase(c.id, executions);
    const cassetteState = await readCassetteState(c.outputPath);
    caseResults.push({ ...reliability, cassetteState });
  }

  const passed = caseResults.filter((c) => c.state === "PASS").length;
  const flaky = caseResults.filter((c) => c.state === "FLAKY").length;
  const regression = caseResults.filter((c) => c.state === "REGRESSION").length;
  const errors = caseResults.filter((c) => c.state === "ERROR").length;

  return {
    suiteName: suite.name,
    cases: caseResults,
    passed,
    flaky,
    regression,
    errors,
  };
}
