/**
 * Evaluation engine.
 * Takes a TestCase + ModelOutput → TestResult.
 * No I/O, no CLI knowledge.
 */

import { evaluateAssertions } from "./assertions.js";
import type { ModelOutput, TestCase, TestResult } from "./types.js";

export function evaluateTestCase(
  testCase: TestCase,
  output: ModelOutput
): TestResult {
  const assertionResults = evaluateAssertions(testCase.assertions, output);
  const passed = assertionResults.every((r) => r.passed);

  return {
    caseId: testCase.id,
    passed,
    assertionResults,
  };
}
