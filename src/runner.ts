/**
 * Test runner (Stage 2 — supports --repeat N).
 * Orchestrates loader → provider → engine → reliability classifier.
 * B3: multi-turn conversation execution (D4/D5/D10).
 */

import { readFile } from "node:fs/promises";
import { evaluateTestCase } from "./engine.js";
import { evaluateAssertions } from "./assertions.js";
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
  AssertionResult,
  CaseReliability,
  ModelAdapter,
  Suite,
  TestCase,
  TestResult,
} from "./types.js";

export type RunOptions = {
  suitePath: string;
  caseId?: string;
  repeat?: number;
  provider?: ModelAdapter;
};

export type RunSummary = {
  suiteName: string;
  cases: CaseReliability[];
  passed: number;
  flaky: number;
  regression: number;
  errors: number;
  warnings: number;
};

const PREVIEW_MAX = 200;

function preview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= PREVIEW_MAX) return t;
  return t.slice(0, PREVIEW_MAX) + "…";
}

async function runSingleTurn(
  testCase: TestCase,
  provider: ModelAdapter
): Promise<TestResult> {
  if (!testCase.input) {
    throw new Error(`Case "${testCase.id}" missing input path`);
  }
  const [inputText, promptText] = await Promise.all([
    readFile(testCase.input, "utf8"),
    readFile(testCase.prompt, "utf8"),
  ]);

  let driftWarning: string | undefined;
  let driftMeta:
    | {
        state: "soft";
        promptStale: boolean;
        inputStale: boolean;
        cassetteState: "recorded";
        message: string;
      }
    | undefined;
  let savedOutput: string | undefined;

  if (provider instanceof SavedOutputAdapter) {
    const freshness = await checkCassetteFresh(
      testCase.outputPath,
      inputText,
      promptText
    );
    if (!freshness.fresh && freshness.severity === "soft") {
      const parts: string[] = [];
      if (freshness.promptStale) {
        parts.push("Prompt changed since output was recorded.");
      }
      if (freshness.inputStale) {
        parts.push("Input changed since output was recorded.");
      }
      driftWarning =
        parts.join(" ") +
        " Evaluating against a drifted recorded baseline. " +
        "Re-capture with `desurf record --force` or re-seal with `desurf seal --force` to refresh.";
      driftMeta = {
        state: "soft",
        promptStale: freshness.promptStale,
        inputStale: freshness.inputStale,
        cassetteState: "recorded",
        message: driftWarning,
      };
    } else {
      await assertCassetteFresh(testCase.outputPath, inputText, promptText);
    }
  }

  const output = await provider.execute({
    input: inputText,
    prompt: promptText,
    outputPath: testCase.outputPath,
  });

  if (savedOutput === undefined) {
    try {
      savedOutput = await readFile(testCase.outputPath, "utf8");
    } catch {
      savedOutput = undefined;
    }
  }

  if (provider instanceof SavedOutputAdapter) {
    await verifyCassetteOutput(testCase.outputPath, output.text);
  }

  const result = evaluateTestCase(testCase, output);

  if (driftWarning) {
    result.warnings = [driftWarning];
    result.drift = driftMeta;
  }

  if (savedOutput !== undefined && savedOutput !== output.text) {
    result.diff = unifiedDiff(savedOutput, output.text);
  }

  return result;
}

async function runMultiTurn(
  testCase: TestCase,
  provider: ModelAdapter
): Promise<TestResult> {
  const turns = testCase.turns!;
  const promptText = await readFile(testCase.prompt, "utf8");
  const turnUserTexts: string[] = [];
  for (const turn of turns) {
    turnUserTexts.push(await readFile(turn.user, "utf8"));
  }
  const firstUserText = turnUserTexts[0]!;
  let driftWarning: string | undefined;
  let driftMeta: TestResult["drift"];

  if (provider instanceof SavedOutputAdapter) {
    const freshness = await checkCassetteFresh(
      testCase.outputPath,
      firstUserText,
      promptText,
      turnUserTexts
    );
    if (!freshness.fresh && freshness.severity === "soft") {
      const turnHint =
        freshness.staleTurnIndex !== undefined
          ? ` Turn ${freshness.staleTurnIndex} user file is stale.`
          : "";
      driftWarning =
        "Prompt or turn user file changed since output was recorded." +
        turnHint +
        " Evaluating against a drifted recorded baseline. " +
        "Re-capture with `desurf record --force` or re-seal with `desurf seal --force` to refresh.";
      driftMeta = {
        state: "soft",
        promptStale: freshness.promptStale,
        inputStale: freshness.inputStale,
        cassetteState: "recorded",
        message: driftWarning,
        staleTurnIndex: freshness.staleTurnIndex,
      };
    } else if (!freshness.fresh) {
      const turnHint =
        freshness.staleTurnIndex !== undefined
          ? ` (first stale turn index: ${freshness.staleTurnIndex})`
          : "";
      throw new Error(
        `Sealed cassette is stale for case "${testCase.id}"${turnHint}. ` +
          `Re-seal with \`desurf seal --force\` after updating fixtures.`
      );
    }

    try {
      const raw = await readFile(testCase.outputPath, "utf8");
      const parsed = JSON.parse(raw) as { turns?: unknown[] };
      if (!Array.isArray(parsed.turns) || parsed.turns.length !== turns.length) {
        throw new Error(
          `Transcript turn count mismatch at ${testCase.outputPath}: ` +
            `case has ${turns.length} turns, transcript has ${Array.isArray(parsed.turns) ? parsed.turns.length : "none"}`
        );
      }
      // E8: authenticate sealed transcript bytes (outputSha256) before replay.
      await verifyCassetteOutput(testCase.outputPath, raw);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(
          `Malformed transcript at ${testCase.outputPath}: ${err.message}`
        );
      }
      throw err;
    }
  }

  type HistItem = { role: "user" | "assistant"; content: string };
  const history: HistItem[] = [];
  const turnResults: NonNullable<TestResult["turns"]> = [];
  const allAssertionResults: AssertionResult[] = [];
  let providerError: string | undefined;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const userText = await readFile(turn.user, "utf8");

    let outputText: string;
    try {
      const output = await provider.execute({
        input: userText,
        prompt: promptText,
        outputPath: testCase.outputPath,
        history: history.length > 0 ? [...history] : undefined,
        turnIndex: i,
      });
      outputText = output.text;
    } catch (err) {
      providerError = err instanceof Error ? err.message : String(err);
      turnResults.push({
        index: i,
        passed: false,
        assertionResults: [],
        error: providerError,
      });
      break;
    }

    const turnAssertions = turn.assertions ?? [];
    const turnAresults = evaluateAssertions(turnAssertions, { text: outputText });
    for (const ar of turnAresults) {
      ar.turnIndex = i;
    }
    const turnPassed = turnAresults.every((r) => r.passed);
    allAssertionResults.push(...turnAresults);
    turnResults.push({
      index: i,
      passed: turnPassed,
      assertionResults: turnAresults,
      outputPreview: preview(outputText),
    });

    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: outputText });
  }

  if (providerError) {
    return {
      caseId: testCase.id,
      passed: false,
      assertionResults: allAssertionResults,
      error: providerError,
      turns: turnResults,
      warnings: driftWarning ? [driftWarning] : undefined,
      drift: driftMeta,
    };
  }

  const lastOutput =
    history.filter((h) => h.role === "assistant").pop()?.content ?? "";
  const caseAresults = evaluateAssertions(testCase.assertions, {
    text: lastOutput,
  });
  allAssertionResults.push(...caseAresults);

  const allTurnsPassed = turnResults.every((t) => t.passed);
  const caseLevelPassed = caseAresults.every((r) => r.passed);
  const passed = allTurnsPassed && caseLevelPassed;

  const result: TestResult = {
    caseId: testCase.id,
    passed,
    assertionResults: allAssertionResults,
    outputPreview: preview(lastOutput),
    turns: turnResults,
  };
  if (driftWarning) {
    result.warnings = [driftWarning];
    result.drift = driftMeta;
  }

  return result;
}

async function runOneExecution(
  testCase: TestCase,
  provider: ModelAdapter
): Promise<TestResult> {
  try {
    if (testCase.turns && testCase.turns.length > 0) {
      return await runMultiTurn(testCase, provider);
    }
    return await runSingleTurn(testCase, provider);
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
