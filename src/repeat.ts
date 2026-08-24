/**
 * Repeat / Reliability Engine (Stage 2).
 *
 * Pure classification: TestResult[] → ReliabilityState.
 * Does NOT evaluate assertions. Does NOT talk to providers.
 */

import type { CaseReliability, ReliabilityState, TestResult } from "./types.js";

/**
 * Classify a sequence of execution results for one case.
 *
 * Rules (from blueprint):
 * - ERROR     if any execution has an error
 * - PASS      if all executions passed (and none errored)
 * - REGRESSION if all executions completed but all failed assertions
 * - FLAKY     if at least one pass and at least one fail (no errors)
 */
export function classifyReliability(
  executions: TestResult[]
): ReliabilityState {
  if (executions.length === 0) {
    return "ERROR";
  }

  const errorCount = executions.filter((r) => r.error).length;
  if (errorCount > 0) {
    return "ERROR";
  }

  const passCount = executions.filter((r) => r.passed).length;
  const failCount = executions.length - passCount;

  if (passCount === executions.length) {
    return "PASS";
  }
  if (failCount === executions.length) {
    return "REGRESSION";
  }
  return "FLAKY";
}

/** Build a CaseReliability summary from N execution results. */
export function summarizeCase(
  caseId: string,
  executions: TestResult[]
): CaseReliability {
  const passCount = executions.filter((r) => r.passed && !r.error).length;
  const errorCount = executions.filter((r) => r.error).length;
  const failCount = executions.length - passCount - errorCount;

  return {
    caseId,
    state: classifyReliability(executions),
    executions,
    passCount,
    failCount,
    errorCount,
  };
}
