/**
 * Core types for Desurf.
 * Keep small and explicit. No premature abstraction.
 */

/** A single behavioral assertion. */
export type Assertion =
  | { type: "required"; value: string; caseSensitive?: boolean }
  | { type: "forbidden"; value: string; caseSensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json_schema"; schema: Record<string, unknown> };

/** One test case from a suite. */
export type TestCase = {
  id: string;
  input: string;
  prompt: string;
  /** Path relative to the suite directory; must resolve inside it (loader rejects absolute paths and `..` escapes). */
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
  provider?: string;
  model?: string;
  metadata?: Record<string, unknown>;
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
  /** Truncated output text for diagnostic context (optional). */
  outputPreview?: string;
};

/**
 * Reliability classification after repeated execution.
 * Stage 2.
 */
export type ReliabilityState = "PASS" | "FLAKY" | "REGRESSION" | "ERROR";

/**
 * Offline cassette provenance state for one case's saved output.
 * - unsealed: no `.desurf` sidecar (legacy / unprotected)
 * - sealed: `.desurf` present from `desurf seal` (or legacy sidecar without source)
 * - recorded: `.desurf` present from `desurf record`
 */
export type CassetteState = "unsealed" | "sealed" | "recorded";

/** Aggregated result for one test case after N executions. */
export type CaseReliability = {
  caseId: string;
  state: ReliabilityState;
  /** Individual execution results (length = repeat count). */
  executions: TestResult[];
  passCount: number;
  failCount: number;
  errorCount: number;
  /** Provenance state of the offline cassette (saved output). */
  cassetteState: CassetteState;
};

/** Request passed to a provider. */
export type ExecuteRequest = {
  input: string;
  prompt: string;
  /** Absolute path to the expected saved output (offline mode). */
  outputPath?: string;
  /** Optional model id override */
  model?: string;
  /**
   * Optional system prompt prepended to the user message. Most production
   * prompts are system-shaped ("You are a JSON-only classifier..."); without
   * this, authors had to stuff the system instructions into the user prompt,
   * which some models treat differently and which the recorder then
   * fingerprints as part of the "prompt" file — conflating role and content.
   * Read from the case's prompt file by default; can be overridden by the
   * adapter.
   */
  systemPrompt?: string;
  /** Sampling temperature override (provider default is 0 for determinism). */
  temperature?: number;
  /** Best-effort determinism seed (OpenAI-compatible endpoints). */
  seed?: number;
  /** Max output tokens (omitted = provider default). */
  maxTokens?: number;
};

/** Generation parameters shared across live providers. */
export type GenerationParams = {
  /** Model id. Uses provider default if omitted. */
  model?: string;
  /** API key override (primarily for tests). */
  apiKey?: string;
  /** Custom fetch (primarily for tests). */
  fetch?: typeof globalThis.fetch;
  /** Custom base URL (primarily for tests / proxies). */
  baseUrl?: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Max retries on transient (408/429/5xx/network) errors. 0 = single attempt. */
  maxRetries?: number;
  /** Sampling temperature. Provider default is 0 (deterministic). */
  temperature?: number;
  /** Best-effort determinism seed. */
  seed?: number;
  /** Max output tokens. */
  maxTokens?: number;
  /** System prompt prepended to every user message. */
  systemPrompt?: string;
};

/** Provider interface — engine depends only on this. */
export interface ModelAdapter {
  readonly name?: string;
  execute(request: ExecuteRequest): Promise<ModelOutput>;
}
