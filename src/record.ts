/**
 * desurf record — capture live provider output, classify vs baseline,
 * write history snapshots. Propose mode never mutates an existing baseline.
 */

import { access, constants, stat, readFile } from "node:fs/promises";
import { loadSuite } from "./offline.js";
import {
  writeCassetteMeta,
  sha256Normalized,
  readCassetteMeta,
  verifyCassetteOutput,
} from "./fingerprint.js";
import { atomicWriteFile } from "./fs-utils.js";
import { evaluateAssertions } from "./assertions.js";
import { unifiedDiff } from "./diff.js";
import {
  writeRecordSnapshot,
  writeBaselineBackupSnapshot,
  DEFAULT_HISTORY_LIMIT,
  sanitizeCaseDirName,
} from "./history.js";
import type { ModelAdapter, Suite, TestCase, ModelOutput } from "./types.js";

export type RecordVerdict = "new" | "unchanged" | "drift" | "error";

export type RecordOptions = {
  suitePath: string;
  provider: ModelAdapter;
  providerName: string;
  model?: string;
  caseId?: string;
  force?: boolean;
  fillGaps?: boolean;
  historyLimit?: number;
  cliVersion?: string;
};

export type RecordCaseResult = {
  caseId: string;
  status: "recorded" | "skipped" | "error" | RecordVerdict;
  verdict: RecordVerdict;
  message: string;
  assertionsPassed?: boolean | null;
  baselineSha256?: string | null;
  outputSha256?: string | null;
  snapshot?: string | null;
  diff?: string | null;
};

export type RecordSummary = {
  suiteName: string;
  suiteRoot: string;
  providerName: string;
  model?: string;
  results: RecordCaseResult[];
  summary: { total: number; new: number; unchanged: number; drift: number; error: number };
};

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

function countSummary(results: RecordCaseResult[]) {
  const s = { total: results.length, new: 0, unchanged: 0, drift: 0, error: 0 };
  for (const r of results) {
    if (r.verdict === "new") s.new++;
    else if (r.verdict === "unchanged") s.unchanged++;
    else if (r.verdict === "drift") s.drift++;
    else if (r.verdict === "error") s.error++;
  }
  return s;
}

function runAssertions(testCase: TestCase, text: string): boolean | null {
  try {
    const results = evaluateAssertions(testCase.assertions, { text });
    return results.every((r) => r.passed);
  } catch {
    return null;
  }
}

async function recordOne(
  suite: Suite,
  testCase: TestCase,
  provider: ModelAdapter,
  providerName: string,
  model: string | undefined,
  opts: { force: boolean; fillGaps: boolean; historyLimit: number; cliVersion: string }
): Promise<RecordCaseResult> {
  const caseId = testCase.id;
  try {
    sanitizeCaseDirName(caseId);
  } catch (err) {
    return { caseId, status: "error", verdict: "error", message: err instanceof Error ? err.message : String(err) };
  }

  try {
    const hasBaseline = await isNonEmptyFile(testCase.outputPath);
    if (opts.fillGaps && hasBaseline) {
      return {
        caseId, status: "skipped", verdict: "unchanged",
        message: `Output already exists (fill-gaps skips existing): ${testCase.outputPath}`,
      };
    }

    const [inputText, promptText] = await Promise.all([
      readFile(testCase.input, "utf8"),
      readFile(testCase.prompt, "utf8"),
    ]);

    if (typeof (provider as { execute?: unknown }).execute !== "function" || !provider.execute) {
      throw new Error(`Provider "${providerName}" is not executable — cannot record new outputs.`);
    }

    const output: ModelOutput = await provider.execute({
      input: inputText, prompt: promptText, outputPath: testCase.outputPath, model,
    });

    if (output.text === "") {
      return { caseId, status: "error", verdict: "error", message: "provider returned an empty response" };
    }

    const newText = output.text;
    const outputSha256 = sha256Normalized(newText);
    const inputSha256 = sha256Normalized(inputText);
    const promptSha256 = sha256Normalized(promptText);
    const assertionsPassed = runAssertions(testCase, newText);

    if (opts.force) {
      let backupRel: string | null = null;
      let prevBaselineSha: string | null = null;
      if (hasBaseline) {
        const baselineText = await readFile(testCase.outputPath, "utf8");
        prevBaselineSha = sha256Normalized(baselineText);
        let meta = null;
        try { meta = await readCassetteMeta(testCase.outputPath); } catch { meta = null; }
        const backup = await writeBaselineBackupSnapshot({
          suiteRoot: suite.rootDir, caseId, output: baselineText, metaAtCapture: meta,
          cliVersion: opts.cliVersion, provider: providerName, model: model ?? null,
          historyLimit: opts.historyLimit,
        });
        backupRel = backup.relativePath;
      }
      await atomicWriteFile(testCase.outputPath, newText, "utf8");
      await writeCassetteMeta(testCase.outputPath, inputText, promptText, "record", newText,
        output.provider ?? providerName, output.model ?? model);
      return {
        caseId, status: "recorded", verdict: hasBaseline ? "drift" : "new",
        message: hasBaseline
          ? `--force accepted immediately; previous baseline saved to ${backupRel}`
          : `Recorded ${newText.length} chars → ${testCase.outputPath}`,
        assertionsPassed, baselineSha256: prevBaselineSha, outputSha256, snapshot: backupRel, diff: null,
      };
    }

    if (!hasBaseline) {
      await atomicWriteFile(testCase.outputPath, newText, "utf8");
      await writeCassetteMeta(testCase.outputPath, inputText, promptText, "record", newText,
        output.provider ?? providerName, output.model ?? model);
      const snap = await writeRecordSnapshot({
        suiteRoot: suite.rootDir, caseId, output: newText, provider: providerName,
        model: model ?? null, inputSha256, promptSha256, baselineSha256AtCapture: null,
        verdictAtCapture: "new", assertionsPassed, cliVersion: opts.cliVersion,
        historyLimit: opts.historyLimit,
      });
      return {
        caseId, status: "recorded", verdict: "new",
        message: `first capture → ${testCase.outputPath}`,
        assertionsPassed, baselineSha256: null, outputSha256, snapshot: snap.relativePath, diff: null,
      };
    }

    const baselineText = await readFile(testCase.outputPath, "utf8");
    const baselineSha256 = sha256Normalized(baselineText);
    let tamperWarning: string | null = null;
    try { await verifyCassetteOutput(testCase.outputPath, baselineText); }
    catch { tamperWarning = `WARNING: baseline for ${caseId} fails its own output fingerprint; it was modified after capture`; }

    if (baselineSha256 === outputSha256) {
      return {
        caseId, status: "skipped", verdict: "unchanged",
        message: tamperWarning ? `${tamperWarning}; baseline == new` :
          `baseline ${baselineSha256.slice(0, 4)}…${baselineSha256.slice(-2)} == new ${outputSha256.slice(0, 4)}…${outputSha256.slice(-2)}`,
        assertionsPassed, baselineSha256, outputSha256, snapshot: null, diff: null,
      };
    }

    const snap = await writeRecordSnapshot({
      suiteRoot: suite.rootDir, caseId, output: newText, provider: providerName,
      model: model ?? null, inputSha256, promptSha256, baselineSha256AtCapture: baselineSha256,
      verdictAtCapture: "drift", assertionsPassed, cliVersion: opts.cliVersion,
      historyLimit: opts.historyLimit,
    });
    const diff = unifiedDiff(baselineText, newText);
    return {
      caseId, status: "recorded", verdict: "drift",
      message: tamperWarning
        ? `${tamperWarning}; Live output differs from baseline; snapshot written; baseline untouched`
        : `Live output differs from baseline; snapshot written; baseline untouched`,
      assertionsPassed, baselineSha256, outputSha256, snapshot: snap.relativePath, diff,
    };
  } catch (err) {
    return { caseId, status: "error", verdict: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function recordSuite(options: RecordOptions): Promise<RecordSummary> {
  if (options.providerName === "offline" || options.providerName === "saved" || options.providerName === "saved-output") {
    throw new Error(`record requires a live provider (e.g. openrouter, openai, anthropic, gemini). Offline provider cannot capture new outputs.`);
  }
  if (options.historyLimit !== undefined && (!Number.isInteger(options.historyLimit) || options.historyLimit < 1 || options.historyLimit > 100)) {
    throw new Error(`--history-limit must be an integer between 1 and 100 (got ${options.historyLimit})`);
  }
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const suite: Suite = await loadSuite(options.suitePath);
  let cases = suite.cases;
  if (options.caseId) {
    cases = cases.filter((c) => c.id === options.caseId);
    if (cases.length === 0) throw new Error(`No test case with id "${options.caseId}" in suite "${suite.name}"`);
  }
  const force = options.force === true;
  const fillGaps = options.fillGaps === true;
  const cliVersion = options.cliVersion ?? "0.5.0";
  const results: RecordCaseResult[] = [];
  for (const c of cases) {
    results.push(await recordOne(suite, c, options.provider, options.providerName, options.model, { force, fillGaps, historyLimit, cliVersion }));
  }
  return { suiteName: suite.name, suiteRoot: suite.rootDir, providerName: options.providerName, model: options.model, results, summary: countSummary(results) };
}

export function recordExitCode(summary: RecordSummary, opts: { force?: boolean; fillGaps?: boolean }): number {
  if (summary.results.some((r) => r.verdict === "error")) return 2;
  if (opts.force || opts.fillGaps) return 0;
  if (summary.summary.drift > 0) return 1;
  return 0;
}
