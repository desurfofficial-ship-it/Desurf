/**
 * Repeat / Reliability Engine (Stage 2).
 *
 * Pure classification: TestResult[] → ReliabilityState.
 * Does NOT evaluate assertions. Does NOT talk to providers.
 */

import type { CaseReliability, ReliabilityState, TestResult } from "./types.js";

/**
 * Hard ceilings for --repeat.
 *
 * There was previously no upper bound, and Number() silently accepts
 * "0x10" (hex 16) and "1e9" (1,000,000,000): `desurf test --repeat 1e9`
 * parked the CI gate effectively forever offline, or with a live provider
 * billed a billion network calls. The CLI enforces decimal syntax; both
 * the CLI and runSuite() enforce these numeric ceilings, so library
 * callers get the same guarantee as the flag parser.
 */

/** Max repetitions per case for offline evaluation (bounded local work). */
export const MAX_REPEAT_OFFLINE = 1000;

/** Max repetitions per case when the provider is live (network + money). */
export const MAX_REPEAT_LIVE = 100;

/** Validate a repeat count supplied by any caller (CLI flag or runSuite). */
export function validateRepeat(n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--repeat must be a positive integer, got: ${n}`);
  }
  if (n > MAX_REPEAT_OFFLINE) {
    throw new Error(
      `--repeat is capped at ${MAX_REPEAT_OFFLINE} (got: ${n}). ` +
        `Wrap desurf in a script loop if you truly need more repetitions per run.`
    );
  }
  return n;
}

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
    // Runner overwrites with disk-derived state; default is unsealed.
    cassetteState: "unsealed",
  };
}
