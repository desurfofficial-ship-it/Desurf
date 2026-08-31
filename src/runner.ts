/**
 * Test runner (Stage 2 — supports --repeat N).
 * Orchestrates loader → provider → engine → reliability classifier.
 */

import { readFile } from "node:fs/promises";
import { evaluateTestCase } from "./engine.js";
import { loadSuite } from "./offline.js";
import {
  assertCassetteFresh,
  checkCassetteFresh,
  readCassetteState,
  verifyCassetteOutput,
} from "./fingerprint.js";
import { unifiedDiff } from "./diff.js";
import { SavedOutputAdapter } from "./provider.js";
import { summarizeCase, validateRepeat } from "./repeat.js";
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
  /** Non-fatal warnings (soft cassette drift). Run still passes (exit 0). */
  warnings: number;
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

    let driftWarning: string | undefined;
    let driftMeta:
      | { state: "soft"; promptStale: boolean; inputStale: boolean; cassetteState: "recorded"; message: string }
      | undefined;
    let savedOutput: string | undefined;

    // Stale-fixture check only applies offline (saved cassette evaluation).
    if (provider instanceof SavedOutputAdapter) {
      const freshness = await checkCassetteFresh(
        testCase.outputPath,
        inputText,
        promptText
      );
      if (!freshness.fresh && freshness.severity === "soft") {
        // Recorded baseline drifted (prompt/input changed since capture).
        // This is a WARNING, not an ERROR: the cassette still stands as
        // the "old" side of the comparison and assertions still run.
        const parts: string[] = [];
        if (freshness.promptStale) {
          parts.push("Prompt changed since output was recorded.");
        }
        if (freshness.inputStale) {
          parts.push("Input changed since output was recorded.");
        }
        // The warning text itself carries no "WARNING:" prefix — the
        // formatter adds exactly one prefix per line. (v0.4.3: previously
        // the message embedded a second "WARNING:" prefix, which produced
        // duplicated prefixes in human output.)
        driftWarning =
          parts.join(" ") +
          " Evaluating against a drifted recorded baseline. " +
          "Re-capture with `desurf record --force` or re-seal with `desurf seal --force` to refresh.";
        // Structured drift metadata so --json consumers can tell a
        // contract PASS from a clean PASS: the contract passed, but the
        // baseline drifted (and exactly which side changed).
        driftMeta = {
          state: "soft",
          promptStale: freshness.promptStale,
          inputStale: freshness.inputStale,
          cassetteState: "recorded",
          message: driftWarning,
        };
      } else {
        // Hard drift (sealed/legacy): refuse to evaluate — ERROR (exit 2).
        await assertCassetteFresh(testCase.outputPath, inputText, promptText);
      }
    }

    const output = await provider.execute({
      input: inputText,
      prompt: promptText,
      outputPath: testCase.outputPath,
    });

    // Best-effort read of the saved cassette (offline OR live-provider
    // runs): it becomes the "old" side of the P5 regression diff. When
    // the provider IS the saved output, this is the output being
    // evaluated; when it is a live provider, it is the baseline the new
    // output is compared against.
    if (savedOutput === undefined) {
      try {
        savedOutput = await readFile(testCase.outputPath, "utf8");
      } catch {
        savedOutput = undefined; // no cassette on disk (fresh live run)
      }
    }

    // Authenticate the cassette itself (v2 sidecars): without this, an
    // output file edited after sealing would be evaluated as if it were
    // the sealed bytes, with provenance still reporting "fresh".
    if (provider instanceof SavedOutputAdapter) {
      await verifyCassetteOutput(testCase.outputPath, output.text);
    }

    const result = evaluateTestCase(testCase, output);

    if (driftWarning) {
      result.warnings = [driftWarning];
      result.drift = driftMeta;
    }

    // Diff on regression (P5): when the evaluated output differs from the
    // saved cassette, show old-vs-new. This applies to live-provider runs
    // against a saved cassette AND offline evaluation after a soft drift
    // (where the fresh prompt produced a different saved output).
    if (savedOutput !== undefined && savedOutput !== output.text) {
      result.diff = unifiedDiff(savedOutput, output.text);
    }

    return result;
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
  // Enforce the same ceiling as the CLI for library callers: a repeat
  // count that is not a positive integer within the cap is a programming
  // error and must fail loudly, not silently pin the CPU for a week.
  // (Previously `Math.max(1, repeat)` quietly turned 0/-7/NaN into 1.)
  const repeat = validateRepeat(options.repeat ?? 1);

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
  const warnings = caseResults.reduce(
    (acc, c) =>
      acc +
      c.executions.reduce(
        (n, e) => n + (e.warnings ? e.warnings.length : 0),
        0
      ),
    0
  );

  return {
    suiteName: suite.name,
    cases: caseResults,
    passed,
    flaky,
    regression,
    errors,
    warnings,
  };
}
