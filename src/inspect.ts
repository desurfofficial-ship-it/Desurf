/**
 * Read-only cassette provenance inspection.
 *
 * Does not evaluate assertions, call providers, or write any files.
 */

import { readFile } from "node:fs/promises";
import { loadSuite } from "./offline.js";
import {
  cassetteStateFromMeta,
  metaPathFor,
  readCassetteMeta,
  sha256,
  type CassetteMeta,
  type CassetteStateLabel,
} from "./fingerprint.js";
import type { Suite, TestCase } from "./types.js";

export type ProvenanceStatus =
  | "unsealed"
  | "fresh"
  | "stale"
  | "invalid";

/** Cassette identity for inspection. "invalid" = sidecar present but unreadable. */
export type InspectCassetteState = CassetteStateLabel | "invalid";

export type CaseInspectResult = {
  caseId: string;
  outputPath: string;
  metaPath: string;
  cassetteState: InspectCassetteState;
  metaPresent: boolean;
  /** null when unsealed or invalid meta */
  promptFresh: boolean | null;
  /** null when unsealed or invalid meta */
  inputFresh: boolean | null;
  provenanceStatus: ProvenanceStatus;
  /** Human-readable detail when stale or invalid */
  detail?: string;
};

export type InspectSummary = {
  suiteName: string;
  cases: CaseInspectResult[];
};

export type InspectOptions = {
  suitePath: string;
  caseId?: string;
};

async function inspectOne(testCase: TestCase): Promise<CaseInspectResult> {
  const metaPath = metaPathFor(testCase.outputPath);
  const base = {
    caseId: testCase.id,
    outputPath: testCase.outputPath,
    metaPath,
  };

  let meta: CassetteMeta | null;
  try {
    meta = await readCassetteMeta(testCase.outputPath);
  } catch (err) {
    return {
      ...base,
      // Sidecar exists but is unreadable — not the same as UNSEALED.
      cassetteState: "invalid",
      metaPresent: true,
      promptFresh: null,
      inputFresh: null,
      provenanceStatus: "invalid",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!meta) {
    return {
      ...base,
      cassetteState: "unsealed",
      metaPresent: false,
      promptFresh: null,
      inputFresh: null,
      provenanceStatus: "unsealed",
    };
  }

  const cassetteState = cassetteStateFromMeta(meta);
  const [inputText, promptText] = await Promise.all([
    readFile(testCase.input, "utf8"),
    readFile(testCase.prompt, "utf8"),
  ]);

  const inputFresh = meta.inputSha256 === sha256(inputText);
  const promptFresh = meta.promptSha256 === sha256(promptText);

  if (inputFresh && promptFresh) {
    return {
      ...base,
      cassetteState,
      metaPresent: true,
      promptFresh,
      inputFresh,
      provenanceStatus: "fresh",
    };
  }

  const parts: string[] = [];
  if (!promptFresh) parts.push("prompt does not match stored fingerprint");
  if (!inputFresh) parts.push("input does not match stored fingerprint");

  return {
    ...base,
    cassetteState,
    metaPresent: true,
    promptFresh,
    inputFresh,
    provenanceStatus: "stale",
    detail: parts.join("; "),
  };
}

/**
 * Inspect provenance for every selected case in a suite.
 * Read-only: never writes files, never calls providers.
 */
export async function inspectSuite(
  options: InspectOptions
): Promise<InspectSummary> {
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

  const results: CaseInspectResult[] = [];
  for (const c of cases) {
    results.push(await inspectOne(c));
  }

  return {
    suiteName: suite.name,
    cases: results,
  };
}
