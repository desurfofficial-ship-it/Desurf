/**
 * desurf record — run a live provider and save outputs into the suite.
 */

import { access, constants, stat, readFile } from "node:fs/promises";
import { loadSuite } from "./offline.js";
import { writeCassetteMeta } from "./fingerprint.js";
import { atomicWriteFile } from "./fs-utils.js";
import type { ModelAdapter, Suite, TestCase } from "./types.js";

export type RecordOptions = {
  suitePath: string;
  provider: ModelAdapter;
  providerName: string;
  model?: string;
  caseId?: string;
  force?: boolean;
};

export type RecordCaseResult = {
  caseId: string;
  status: "recorded" | "skipped" | "error";
  message: string;
};

export type RecordSummary = {
  suiteName: string;
  results: RecordCaseResult[];
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

async function recordOne(
  testCase: TestCase,
  provider: ModelAdapter,
  providerName: string,
  model: string | undefined,
  force: boolean
): Promise<RecordCaseResult> {
  try {
    if (!force && (await isNonEmptyFile(testCase.outputPath))) {
      return {
        caseId: testCase.id,
        status: "skipped",
        message: `Output already exists (use --force to overwrite): ${testCase.outputPath}`,
      };
    }

    const [inputText, promptText] = await Promise.all([
      readFile(testCase.input, "utf8"),
      readFile(testCase.prompt, "utf8"),
    ]);

    const output = await provider.execute({
      input: inputText,
      prompt: promptText,
      outputPath: testCase.outputPath,
      model,
    });

    await atomicWriteFile(testCase.outputPath, output.text, "utf8");
    // output.text fingerprints the cassette itself (meta v2): post-record
    // edits to the output file become detectable at test time.
    await writeCassetteMeta(
      testCase.outputPath,
      inputText,
      promptText,
      "record",
      output.text,
      output.provider ?? providerName,
      output.model ?? model
    );

    return {
      caseId: testCase.id,
      status: "recorded",
      message: `Recorded ${output.text.length} chars → ${testCase.outputPath}`,
    };
  } catch (err) {
    return {
      caseId: testCase.id,
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function recordSuite(
  options: RecordOptions
): Promise<RecordSummary> {
  if (
    options.providerName === "offline" ||
    options.providerName === "saved" ||
    options.providerName === "saved-output"
  ) {
    throw new Error(
      `record requires a live provider (e.g. openrouter, openai, anthropic, gemini). Offline provider cannot capture new outputs.`
    );
  }

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

  const results: RecordCaseResult[] = [];
  for (const c of cases) {
    results.push(
      await recordOne(
        c,
        options.provider,
        options.providerName,
        options.model,
        options.force === true
      )
    );
  }

  return {
    suiteName: suite.name,
    results,
  };
}
