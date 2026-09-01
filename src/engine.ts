/**
 * Evaluation engine.
 * Takes a TestCase + ModelOutput → TestResult.
 * No I/O, no CLI knowledge.
 */

import { evaluateAssertions, type AssertionEvalContext } from "./assertions.js";
import type { ModelOutput, TestCase, TestResult } from "./types.js";

const PREVIEW_MAX = 200;

function preview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_MAX) return t;
  return t.slice(0, PREVIEW_MAX) + "…";
}

export function evaluateTestCase(
  testCase: TestCase,
  output: ModelOutput,
  ctx?: AssertionEvalContext
): TestResult {
  const assertionResults = evaluateAssertions(testCase.assertions, output, ctx);
  const passed = assertionResults.every((r) => r.passed);

  return {
    caseId: testCase.id,
    passed,
    assertionResults,
    outputPreview: preview(output.text),
  };
}
