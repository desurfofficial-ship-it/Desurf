/**
 * Core types for Desurf.
 * Keep small and explicit. No premature abstraction.
 */

/** A single behavioral assertion. */
export type Assertion =
  | { type: "required"; value: string; caseSensitive?: boolean }
  | { type: "forbidden"; value: string; caseSensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json_schema"; schema: Record<string, unknown>; allowFences?: boolean }
  | { type: "max_diff_lines"; value: number }
  | {
      type: "json_path";
      path: string;
      equals?: unknown;
      oneOf?: unknown[];
      min?: number;
      max?: number;
    };

/** One user turn in a multi-turn conversation case. */
export type TurnDef = {
  /** Absolute path to the user message file (resolved under suite root). */
  user: string;
  /** Optional per-turn assertions (evaluated against this turn's output only). */
  assertions?: Assertion[];
};

/** One test case from a suite. */
export type TestCase = {
  id: string;
  /**
   * Absolute path to the single-turn input file.
   * Absent when `turns` is set (D2: input and turns are mutually exclusive).
   */
  input?: string;
  prompt: string;
  /** Path relative to the suite directory; must resolve inside it (loader rejects absolute paths and `..` escapes). */
  outputPath: string;
  /** Case-level assertions — evaluated against the last turn's output when `turns` is set. */
  assertions: Assertion[];
  /**
   * Optional multi-turn conversation (1–20 turns).
   * When present, `input` must be absent and `outputPath` must end in `.json` (transcript).
   */
  turns?: TurnDef[];
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
  /** Present when the assertion was evaluated against a specific conversation turn. */
  turnIndex?: number;
};

/** Result of evaluating one test case (one execution). */
export type TestResult = {
  caseId: string;
  passed: boolean;
  assertionResults: AssertionResult[];
  error?: string;
  /** Truncated output text for diagnostic context (optional). */
  outputPreview?: string;
  /**
   * Non-fatal diagnostics that did NOT fail the run (e.g. soft cassette
   * drift on a recorded baseline). Surfaced as WARNING lines; the run
   * stays green (exit 0) unless assertions fail.
   */
  warnings?: string[];
  /**
   * Old-vs-new output diff for a regression. Present only when the case
   * ran offline against a saved cassette AND that cassette is the
   * recorded baseline (so "old" is the saved output) AND the evaluation
   * produced a different output. Shown as a unified diff.
   */
  diff?: string;
  /**
   * Structured drift metadata for a soft-drift execution (recorded
   * baseline whose prompt/input changed since capture). Populated by the
   * runner when it detects soft cassette drift; the human-readable
   * warning string stays in `warnings`. Lets --json consumers see that
   * the contract passed against a drifted baseline and exactly which
   * side (prompt/input) changed.
   */
  drift?: {
    state: "soft";
    promptStale: boolean;
    inputStale: boolean;
    cassetteState: "recorded";
    message: string;
    /** First stale turn index when a turns-case user file drifted (D6). */
    staleTurnIndex?: number;
  };
  /**
   * Per-turn results for multi-turn cases (D9). Present only when the case
   * has `turns`. Case `passed` is every turn passed AND case-level assertions.
   */
  turns?: Array<{
    index: number;
    passed: boolean;
    assertionResults: AssertionResult[];
    outputPreview?: string;
    error?: string;
  }>;
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
   * Prior conversation turns for multi-turn cases (D4).
   * Ordered as u0, a0, u1, a1, … before the current user `input`.
   */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * Zero-based turn index for offline transcript replay.
   */
  turnIndex?: number;
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
