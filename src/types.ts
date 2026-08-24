/**
 * Core types for Desurf Stage 1.
 * Keep small and explicit. No premature abstraction.
 */

/** A single behavioral assertion. */
export type Assertion =
  | { type: "required"; value: string }
  | { type: "forbidden"; value: string }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json_schema"; schema: Record<string, unknown> };

/** One test case from a suite. */
export type TestCase = {
  id: string;
  input: string;
  prompt: string;
  /** Path relative to the suite directory, or absolute. */
  outputPath: string;
  assertions: Assertion[];
};

/** A suite loaded from disk. */
export type Suite = {
  name: string;
  /** Absolute path to the suite directory. */
  rootDir: string;
  cases: TestCase[];
};

/** Output produced by a model (or loaded from a saved file). */
export type ModelOutput = {
  text: string;
};

/** Result of evaluating one assertion. */
export type AssertionResult = {
  assertion: Assertion;
  passed: boolean;
  message: string;
};

/** Result of evaluating one test case (one execution). */
export type TestResult = {
  caseId: string;
  passed: boolean;
  assertionResults: AssertionResult[];
  error?: string;
};

/** Request passed to a provider. */
export type ExecuteRequest = {
  input: string;
  prompt: string;
  /** Absolute path to the expected saved output (offline mode). */
  outputPath?: string;
};

/** Provider interface — engine depends only on this. */
export interface ModelAdapter {
  execute(request: ExecuteRequest): Promise<ModelOutput>;
}
