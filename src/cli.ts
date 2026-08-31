#!/usr/bin/env node
/**
 * Desurf CLI
 * Parses args, dispatches commands (test / init / record), sets exit code.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider } from "./create-provider.js";
import { initSuite } from "./init.js";
import { recordSuite } from "./record.js";
import { runSuite } from "./runner.js";
import { sealSuite } from "./seal.js";
import { inspectSuite } from "./inspect.js";
import { watchSuite } from "./watch.js";
import { MAX_REPEAT_LIVE, validateRepeat } from "./repeat.js";
import { SavedOutputAdapter } from "./provider.js";
import type { InspectSummary } from "./inspect.js";
import type { CaseReliability } from "./types.js";
import type { RunSummary } from "./runner.js";

function getVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, "..", "package.json"),
      join(here, "package.json"),
    ];
    for (const p of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // try next
      }
    }
  } catch {
    // fall through
  }
  return "0.4.2";
}

function printRootHelp(): void {
  console.log(`Desurf \u2014 offline-first prompt regression testing

Usage:
  desurf <command> [options]

Commands:
  test      Run a suite against offline saved outputs or a live provider
  init      Create a minimal runnable offline suite
  record    Capture live provider outputs into suite output files
  seal      Establish offline cassette provenance from existing output files
  inspect   Report cassette provenance status (read-only, offline)
  watch     Re-run a suite whenever its files change (iteration loop)

Global options:
  --version, -v    Print version and exit
  --help, -h       Show this help

Exit codes:
  0  PASS
  1  REGRESSION / contract failure (FLAKY or REGRESSION)
  2  ERROR / execution or configuration failure

Run "desurf <command> --help" for command-specific usage.
`);
}

function printTestHelp(): void {
  console.log(`desurf test \u2014 run a behavioral contract suite

Usage:
  desurf test --suite <path> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --case <id>          Run only the named test case
  --repeat <n>         Execute each case N times (default 1; max 1000, or 100 with live providers)
  --provider <name>    offline (default) | openrouter | openai | anthropic | gemini
  --model <id>         Model id for live providers (uses provider default if omitted)
  --temperature <n>    Sampling temperature 0\u20132 (default 0 = deterministic; see note below)
  --seed <n>           Best-effort determinism seed (OpenAI-compatible endpoints)
  --max-tokens <n>     Cap output length (omitted = provider default)
  --timeout-ms <n>     Per-request deadline in ms (default 30000; min 1000; max 600000)
  --max-retries <n>    Retries on transient 429/5xx/network errors (default 0; max 5)
  --system-prompt <s>  System message prepended to every user message
  --verbose            Extra diagnostic output (no secrets)
  --json               Machine-readable JSON on stdout (diagnostics on stderr)
  --help, -h           Show this help

Environment (live providers only):
  OPENROUTER_API_KEY   API key for openrouter (never printed)
  OPENAI_API_KEY       API key for openai (never printed)
  ANTHROPIC_API_KEY    API key for anthropic (never printed)
  GEMINI_API_KEY       API key for gemini (or GOOGLE_API_KEY) (never printed)

Determinism (why --temperature defaults to 0):
  A recorded cassette is meant to be a reproducible baseline. The provider
  default temperature is 1.0 (stochastic), so "desurf record --force" against
  an identical prompt could legitimately produce a different output \u2014 and the
  very next "desurf test" would report a "regression" that is really sampling
  noise. Desurf pins temperature to 0 by default so the offline-cassette
  guarantee actually holds. Pass --temperature 1 to opt into stochastic runs.

  DESURF_TIMEOUT_MS    Fallback per-request deadline if --timeout-ms omitted
  DESURF_MAX_RETRIES   Fallback retry count if --max-retries omitted

Regex safety:
  DESURF_REGEX_TIMEOUT_MS   Hard deadline per regex assertion in ms (default 5000).
                            Catastrophic backtracking is terminated and reported
                            as ERROR (exit 2), never as REGRESSION.

Exit codes:
  0  all tests PASS
  1  quality gate failure (FLAKY or REGRESSION)
  2  execution / configuration / tool error
`);
}

function printInitHelp(): void {
  console.log(`desurf init \u2014 create a minimal runnable offline suite

Usage:
  desurf init <directory>

Creates:
  <directory>/suite.json
  <directory>/inputs/
  <directory>/prompts/
  <directory>/outputs/

The generated suite is immediately runnable:
  desurf init ./my-suite
  desurf test --suite ./my-suite

Safety:
  Refuses to overwrite an existing suite (exit 2).

Options:
  --help, -h    Show this help
`);
}

function printRecordHelp(): void {
  console.log(`desurf record \u2014 capture live provider output into suite files

Usage:
  desurf record --suite <path> --provider <name> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --provider <name>    Live provider: openrouter | openai | anthropic | gemini (required)
  --model <id>         Model id (uses provider default if omitted)
  --temperature <n>    Sampling temperature 0\u20132 (default 0 = deterministic; see desurf test --help)
  --seed <n>           Best-effort determinism seed (OpenAI-compatible endpoints)
  --max-tokens <n>     Cap output length (omitted = provider default; Anthropic requires it and defaults to 4096)
  --timeout-ms <n>     Per-request deadline in ms (default 30000; min 1000; max 600000)
  --max-retries <n>    Retries on transient 429/5xx/network errors (default 0; max 5)
  --system-prompt <s>  System message prepended to every user message
  --case <id>          Record only the named test case
  --force              Overwrite existing non-empty output files
  --help, -h           Show this help

Environment:
  OPENROUTER_API_KEY   Required for openrouter (never printed)
  OPENAI_API_KEY       Required for openai (never printed)
  ANTHROPIC_API_KEY    Required for anthropic (never printed)
  GEMINI_API_KEY       Required for gemini (or GOOGLE_API_KEY) (never printed)

  DESURF_TIMEOUT_MS    Fallback per-request deadline if --timeout-ms omitted
  DESURF_MAX_RETRIES   Fallback retry count if --max-retries omitted

Notes:
  - Does not evaluate assertions; only captures provider output.
  - Existing non-empty outputs are skipped unless --force is set.
  - Partial success is preserved if a later case fails.
  - --temperature defaults to 0 so a re-record against the same prompt/input
    reproduces the same output (otherwise the next test flags spurious drift).

Exit codes:
  0  all selected cases recorded or intentionally skipped
  2  configuration / provider / unknown-case error, or any case failed to record
`);
}

function printSealHelp(): void {
  console.log(`desurf seal \u2014 establish offline cassette provenance from existing outputs

Usage:
  desurf seal --suite <path> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --case <id>          Seal only the named test case
  --force              Overwrite existing .desurf metadata files
  --help, -h           Show this help

Notes:
  - Purely offline. No provider, model, API key, or network required.
  - Hashes current input, prompt, and output files and writes <outputPath>.desurf sidecar
    (v2: fingerprints the output too, so post-seal edits to the cassette and
    line-ending-only recheckouts are both detected correctly).
  - Requires non-empty output files on disk (missing/empty -> error).
  - Existing metadata files are skipped unless --force is set.
  - Prefer seal when you already have a trusted response; use record for live capture.
  - After seal, prompt/input drift is detected by desurf test as ERROR (exit 2).

Exit codes:
  0  all selected cases sealed or intentionally skipped
  2  configuration / file error, or any case failed to seal
`);
}

function printWatchHelp(): void {
  console.log(`desurf watch \u2014 re-run a suite whenever its files change

Usage:
  desurf watch --suite <path> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --case <id>          Run only the named test case
  --repeat <n>         Execute each case N times (default 1; max 1000, or 100 with live providers)
  --provider <name>    offline (default) | openrouter | openai | anthropic | gemini
  --model <id>         Model id for live providers (uses provider default if omitted)
  --temperature <n>    Sampling temperature 0\u20132 (default 0 = deterministic)
  --seed <n>           Best-effort determinism seed (OpenAI-compatible endpoints)
  --max-tokens <n>     Cap output length (omitted = provider default)
  --timeout-ms <n>     Per-request deadline in ms (default 30000; min 1000; max 600000)
  --max-retries <n>    Retries on transient 429/5xx/network errors (default 0; max 5)
  --system-prompt <s>  System message prepended to every user message
  --debounce-ms <n>    Quiet window before re-running after a change (default 250)
  --help, -h           Show this help

Notes:
  - Watches the suite directory (inputs/, prompts/, outputs/, suite.json)
    and re-runs \`desurf test\` on every change, debounced.
  - The iteration loop (tweak prompt \u2192 watch re-runs \u2192 see diff) is the
    fastest way to use Desurf day-to-day.
  - Recorded baselines drift softly by design: a changed prompt re-evaluates
    against the current assertions and shows a diff, keeping the run green
    unless assertions fail.
  - Ctrl+C stops the watcher with exit 0.

Exit codes:
  Same contract as \`desurf test\`: 0 PASS \u00b7 1 REGRESSION/FLAKY \u00b7 2 ERROR
  (reported per run; the watcher itself always exits 0 on stop).
`);
}

function printInspectHelp(): void {
  console.log(`desurf inspect \u2014 report cassette provenance status (read-only)

Usage:
  desurf inspect --suite <path> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --case <id>          Inspect only the named test case
  --json               Machine-readable JSON on stdout
  --help, -h           Show this help

Reports for each case:
  - cassette state: UNSEALED | SEALED | RECORDED | INVALID
  - whether .desurf metadata exists
  - whether current prompt/input match stored fingerprints
  - whether the saved output matches its sealed fingerprint (v2 sidecars)
  - overall provenance status: unsealed | fresh | stale | invalid

Notes:
  - Purely offline. No provider, API key, or network required.
  - Read-only: never writes .desurf files or cassette outputs.
  - Does not evaluate assertions or model behavior.
  - Stale provenance is informational (exit 0); use desurf test for gate.
  - INVALID means a sidecar exists but cannot be parsed (exit 2).

Exit codes:
  0  inspection completed
  2  configuration / suite load / invalid metadata error
`);
}

type ParsedArgs = {
  command: string;
  help?: boolean;
  suite?: string;
  caseId?: string;
  repeat?: number;
  provider?: string;
  model?: string;
  force?: boolean;
  verbose?: boolean;
  json?: boolean;
  // Live-provider generation knobs (ignored by offline adapter).
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  systemPrompt?: string;
  debounceMs?: number;
  positional: string[];
};

/**
 * Parse a numeric CLI flag value with strict decimal syntax.
 * Used by --repeat, --temperature, --seed, --max-tokens, --timeout-ms,
 * --max-retries. Rejects hex (0x10), scientific (1e9), and whitespace so
 * the same coercion bug class that bit --repeat cannot recur here.
 *
 * `kind` is included in the error so the message names the offending flag.
 * `opts.integer` selects integer vs. floating-point parsing.
 */
function parseNumericFlag(
  raw: string,
  kind: string,
  opts: { integer: boolean }
): number {
  if (opts.integer) {
    if (!/^\d+$/.test(raw)) {
      throw new Error(
        `--${kind} must be a non-negative decimal integer (digits 0-9 only), got: ${raw}`
      );
    }
  } else {
    // Allow an optional leading sign and a decimal point. Reject hex / sci.
    if (!/^-?\d+(\.\d+)?$/.test(raw)) {
      throw new Error(
        `--${kind} must be a decimal number, got: ${raw}`
      );
    }
  }
  return Number(raw);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = { command: "", positional: [] };

  if (args.length === 0) {
    result.help = true;
    result.command = "help";
    return result;
  }

  // --version / -v are ONLY valid as the first argument (before any command).
  // The previous full-argv scan made `desurf test --suite s --version` print
  // the version and exit 0 WITHOUT running any test \u2014 a silent-green bypass
  // of the entire CI gate. A version flag that appears after a command is now
  // a hard configuration error (exit 2) instead of a gate no-op.
  const firstArg = args[0];
  if (firstArg === "--version" || firstArg === "-v") {
    result.command = "version";
    return result;
  }

  if (firstArg === "--help" || firstArg === "-h") {
    result.help = true;
    result.command = "help";
    return result;
  }

  result.command = firstArg;
  let i = 1;

  while (i < args.length) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      result.help = true;
      i++;
    } else if (a === "--suite") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --suite requires a value");
      }
      result.suite = args[++i];
      i++;
    } else if (a === "--case") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --case requires a value");
      }
      const val = args[++i];
      if (val === "") {
        throw new Error("Option --case requires a non-empty value");
      }
      result.caseId = val;
      i++;
    } else if (a === "--repeat") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --repeat requires a value");
      }
      const raw = args[++i];
      // Strict decimal syntax. Number() would silently accept "0x10"
      // (hex 16), "1e9" (scientific notation), and " 5 " (whitespace) \u2014
      // surprising coercions for a count that bounds CI runtime and cost.
      if (!/^\d+$/.test(raw)) {
        throw new Error(
          `--repeat must be a positive decimal integer (digits 0-9 only), got: ${raw}`
        );
      }
      const n = Number(raw);
      validateRepeat(n);
      result.repeat = n;
      i++;
    } else if (a === "--provider") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --provider requires a value");
      }
      result.provider = args[++i];
      i++;
    } else if (a === "--model") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --model requires a value");
      }
      result.model = args[++i];
      i++;
    } else if (a === "--temperature") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --temperature requires a value");
      }
      const raw = args[++i];
      const n = parseNumericFlag(raw, "temperature", { integer: false });
      if (n < 0 || n > 2) {
        throw new Error(
          `--temperature must be between 0 and 2 (got ${n}). 0 = deterministic; the provider default for most models is 1.0 (stochastic).`
        );
      }
      result.temperature = n;
      i++;
    } else if (a === "--seed") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --seed requires a value");
      }
      const raw = args[++i];
      const n = parseNumericFlag(raw, "seed", { integer: true });
      result.seed = n;
      i++;
    } else if (a === "--max-tokens") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --max-tokens requires a value");
      }
      const raw = args[++i];
      const n = parseNumericFlag(raw, "max-tokens", { integer: true });
      if (n < 1) {
        throw new Error(`--max-tokens must be a positive integer (got ${n})`);
      }
      result.maxTokens = n;
      i++;
    } else if (a === "--timeout-ms") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --timeout-ms requires a value");
      }
      const raw = args[++i];
      const n = parseNumericFlag(raw, "timeout-ms", { integer: true });
      // Enforce the full valid range UNIFORMLY at CLI parse time (before any
      // provider execution) so the verdict is identical for offline and live
      // modes. Previously only the lower bound (1000) was checked here; the
      // upper bound (600000) was enforced only by resolveTimeoutMs in the
      // live-provider path, which silently clamped. That made
      // `desurf test --timeout-ms 700000` accepted offline (exit 0) but
      // rejected live \u2014 inconsistent (Task 13 finding). Reject loudly here.
      if (n < 1000 || n > 600000) {
        throw new Error(
          `--timeout-ms must be between 1000 and 600000 milliseconds (got ${n}); use a larger value for slow models or raise the provider-side cap.`
        );
      }
      result.timeoutMs = n;
      i++;
    } else if (a === "--max-retries") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --max-retries requires a value");
      }
      const raw = args[++i];
      const n = parseNumericFlag(raw, "max-retries", { integer: true });
      if (n > 5) {
        throw new Error(
          `--max-retries is capped at 5 (got ${n}); each retry is a billed network call.`
        );
      }
      result.maxRetries = n;
      i++;
    } else if (a === "--system-prompt") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --system-prompt requires a value");
      }
      const val = args[++i];
      if (val === "") {
        throw new Error("Option --system-prompt requires a non-empty value");
      }
      result.systemPrompt = val;
      i++;
    } else if (a === "--force") {
      result.force = true;
      i++;
    } else if (a === "--debounce-ms") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --debounce-ms requires a value");
      }
      const raw = args[++i];
      if (!/^\d+$/.test(raw)) {
        throw new Error(
          `--debounce-ms must be a non-negative decimal integer (digits 0-9 only), got: ${raw}`
        );
      }
      const n = Number(raw);
      if (n < 1 || n > 60000) {
        throw new Error(
          `--debounce-ms must be between 1 and 60000 milliseconds (got ${n})`
        );
      }
      result.debounceMs = n;
      i++;
    } else if (a === "--verbose") {
      result.verbose = true;
      i++;
    } else if (a === "--json") {
      result.json = true;
      i++;
    } else if (a === "--version" || a === "-v") {
      throw new Error(
        `Unknown option: ${a} (did you mean: desurf --version ?)`
      );
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    } else {
      result.positional.push(a);
      i++;
    }
  }

  return result;
}

function formatCase(c: CaseReliability, verbose: boolean): string {
  const total = c.executions.length;
  const mark = c.state === "PASS" ? "\u2713" : "\u2717";

  let body = `${mark} ${c.caseId}\n  ${c.state}`;
  if (total > 1) {
    body += `\n  ${c.passCount}/${total} passed`;
  }

  if (c.cassetteState === "unsealed") {
    body +=
      "\n  cassette: UNSEALED (no provenance \u2014 run `desurf seal` to detect prompt/input drift)";
  }

  if (c.state === "ERROR") {
    const firstError = c.executions.find((e) => e.error)?.error;
    if (firstError) {
      body += `\n  ${firstError}`;
    }
  } else if (c.state === "REGRESSION" || c.state === "FLAKY") {
    const failing = c.executions.find((e) => !e.passed && !e.error);
    if (failing) {
      const msgs = failing.assertionResults
        .filter((a) => !a.passed)
        .map((a) => `    - ${a.message}`)
        .join("\n");
      if (msgs) body += `\n${msgs}`;
      if (failing.outputPreview) {
        body += `\n  output: ${failing.outputPreview}`;
      }
      // P5: old-vs-new unified diff when the evaluated output diverged
      // from the saved cassette (live provider drift or soft-drift
      // evaluation). This is the one artifact a regression report cannot
      // do without: what exactly changed.
      if (failing.diff) {
        body += `\n  diff (saved vs evaluated):\n${indentDiff(failing.diff)}`;
      }
    }
  }

  // Soft cassette drift (recorded baseline) \u2014 visible warning, not an
  // error. The run stays green (exit 0) unless assertions fail.
  if (c.state === "PASS" || c.state === "REGRESSION" || c.state === "FLAKY") {
    const warnings = c.executions.flatMap((e) => e.warnings ?? []);
    const seen = new Set<string>();
    for (const w of warnings) {
      if (seen.has(w)) continue;
      seen.add(w);
      body += `\n  WARNING: ${w}`;
    }
  }

  if (verbose && c.state === "PASS") {
    const first = c.executions[0];
    if (first?.outputPreview) {
      body += `\n  output: ${first.outputPreview}`;
    }
  }

  return body;
}

/** Indent a multi-line diff for display inside a case block. */
function indentDiff(diff: string): string {
  return diff
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

function summaryToJson(summary: RunSummary): object {
  return {
    suite: summary.suiteName,
    status:
      summary.errors > 0
        ? "ERROR"
        : summary.flaky > 0 || summary.regression > 0
          ? "REGRESSION"
          : "PASS",
    counts: {
      passed: summary.passed,
      flaky: summary.flaky,
      regression: summary.regression,
      errors: summary.errors,
    },
    cases: summary.cases.map((c) => ({
      id: c.caseId,
      state: c.state,
      cassetteState: c.cassetteState,
      passCount: c.passCount,
      failCount: c.failCount,
      errorCount: c.errorCount,
      executions: c.executions.map((e) => ({
        passed: e.passed,
        error: e.error ?? null,
        assertionFailures: e.assertionResults
          .filter((a) => !a.passed)
          .map((a) => ({
            type: a.assertion.type,
            message: a.message,
          })),
        outputPreview: e.outputPreview ?? null,
      })),
    })),
  };
}

async function cmdTest(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    printTestHelp();
    return 0;
  }
  if (parsed.positional.length > 0) {
    console.error(`Unexpected positional argument: "${parsed.positional[0]}"`);
    printTestHelp();
    return 2;
  }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printTestHelp();
    return 2;
  }

  const suitePath = resolve(parsed.suite);

  let provider;
  try {
    provider = createProvider({
      provider: parsed.provider,
      model: parsed.model,
      temperature: parsed.temperature,
      seed: parsed.seed,
      maxTokens: parsed.maxTokens,
      timeoutMs: parsed.timeoutMs,
      maxRetries: parsed.maxRetries,
      systemPrompt: parsed.systemPrompt,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  // Live providers are billed per call: each repetition of each case is a
  // network request. Cap repetitions far below the offline ceiling so a
  // typo (--repeat 1000) cannot silently become a four-figure API bill.
  if (
    parsed.repeat !== undefined &&
    parsed.repeat > MAX_REPEAT_LIVE &&
    !(provider instanceof SavedOutputAdapter)
  ) {
    console.error(
      `--repeat is capped at ${MAX_REPEAT_LIVE} with live providers (got: ${parsed.repeat}). ` +
        `Each repetition is a billed network call \u2014 use the offline provider ` +
        `for high-repetition reliability sampling.`
    );
    return 2;
  }

  try {
    const summary = await runSuite({
      suitePath,
      caseId: parsed.caseId,
      repeat: parsed.repeat,
      provider,
    });

    if (parsed.json) {
      console.log(JSON.stringify(summaryToJson(summary), null, 2));
    } else {
      console.log("Desurf\n");
      for (const c of summary.cases) {
        console.log(formatCase(c, parsed.verbose === true));
        console.log();
      }
      console.log(
        `Results: ${summary.passed} passed, ${summary.flaky} flaky, ${summary.regression} regression, ${summary.errors} error`
      );
    }

    if (summary.errors > 0) return 2;
    if (summary.flaky > 0 || summary.regression > 0) return 1;
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error("Desurf error:", msg);
    }
    return 2;
  }
}

async function cmdInit(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    printInitHelp();
    return 0;
  }
  if (parsed.positional.length > 1) {
    console.error(`Unexpected extra argument: "${parsed.positional[1]}"`);
    printInitHelp();
    return 2;
  }
  const dir = parsed.positional[0];
  if (!dir) {
    console.error("Missing required argument: <directory>");
    printInitHelp();
    return 2;
  }
  try {
    const created = await initSuite(dir);
    console.log(`Created suite at ${created}`);
    console.log(`Run: desurf test --suite ${created}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function cmdRecord(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    printRecordHelp();
    return 0;
  }
  if (parsed.positional.length > 0) {
    console.error(`Unexpected positional argument: "${parsed.positional[0]}"`);
    printRecordHelp();
    return 2;
  }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printRecordHelp();
    return 2;
  }
  if (!parsed.provider) {
    console.error(
      "Missing required option: --provider <name> (e.g. openrouter, openai, anthropic, gemini)"
    );
    printRecordHelp();
    return 2;
  }

  const providerName = parsed.provider.toLowerCase();
  if (
    providerName === "offline" ||
    providerName === "saved" ||
    providerName === "saved-output"
  ) {
    console.error(
      "record requires a live provider (e.g. openrouter, openai, anthropic, gemini). Offline provider cannot capture new outputs."
    );
    return 2;
  }

  let provider;
  try {
    provider = createProvider({
      provider: parsed.provider,
      model: parsed.model,
      temperature: parsed.temperature,
      seed: parsed.seed,
      maxTokens: parsed.maxTokens,
      timeoutMs: parsed.timeoutMs,
      maxRetries: parsed.maxRetries,
      systemPrompt: parsed.systemPrompt,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  try {
    const summary = await recordSuite({
      suitePath: resolve(parsed.suite),
      provider,
      providerName,
      model: parsed.model,
      caseId: parsed.caseId,
      force: parsed.force,
    });

    console.log(`Desurf record \u2014 suite "${summary.suiteName}"\n`);
    let anyError = false;
    for (const r of summary.results) {
      const mark =
        r.status === "recorded" ? "\u2713" : r.status === "skipped" ? "\u00b7" : "\u2717";
      console.log(`${mark} ${r.caseId}: ${r.status}`);
      console.log(`  ${r.message}`);
      console.log();
      if (r.status === "error") anyError = true;
    }

    // P2: "record succeeded" must not be reported when nothing was
    // captured. If every selected case was skipped (output already
    // exists) and NO case was actually recorded, the command did not do
    // what it was asked to do. With a live provider this is almost always
    // a misconfiguration (missing API key) that would otherwise produce a
    // false-success exit 0 \u2014 a silent skip that looks like a capture.
    const recorded = summary.results.filter((r) => r.status === "recorded").length;
    const selected = summary.results.length;
    if (!anyError && selected > 0 && recorded === 0) {
      console.error(
        `Desurf record error: nothing was recorded (${selected} case${
          selected === 1 ? "" : "s"
        } skipped because output already exists). ` +
          `Use --force to overwrite, or verify the provider can actually execute ` +
          `(e.g. ${providerName.toUpperCase()}_API_KEY is set) before re-running.`
      );
      return 2;
    }

    return anyError ? 2 : 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function cmdSeal(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    printSealHelp();
    return 0;
  }
  if (parsed.positional.length > 0) {
    console.error(`Unexpected positional argument: "${parsed.positional[0]}"`);
    printSealHelp();
    return 2;
  }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printSealHelp();
    return 2;
  }

  try {
    const summary = await sealSuite({
      suitePath: resolve(parsed.suite),
      caseId: parsed.caseId,
      force: parsed.force,
    });

    console.log(`Desurf seal \u2014 suite "${summary.suiteName}"\n`);
    let anyError = false;
    for (const r of summary.results) {
      const mark =
        r.status === "sealed" ? "\u2713" : r.status === "skipped" ? "\u00b7" : "\u2717";
      console.log(`${mark} ${r.caseId}: ${r.status}`);
      console.log(`  ${r.message}`);
      console.log();
      if (r.status === "error") anyError = true;
    }

    return anyError ? 2 : 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}


async function cmdWatch(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    printWatchHelp();
    return 0;
  }
  if (parsed.positional.length > 0) {
    console.error(`Unexpected positional argument: "${parsed.positional[0]}"`);
    printWatchHelp();
    return 2;
  }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printWatchHelp();
    return 2;
  }

  // Same live-provider repeat cap as `test` (billed per call).
  if (
    parsed.repeat !== undefined &&
    parsed.repeat > MAX_REPEAT_LIVE &&
    !(parsed.provider === undefined || parsed.provider === "offline")
  ) {
    console.error(
      `--repeat is capped at ${MAX_REPEAT_LIVE} with live providers (got: ${parsed.repeat}). ` +
        `Each repetition is a billed network call.`
    );
    return 2;
  }

  try {
    await watchSuite({
      suitePath: resolve(parsed.suite),
      caseId: parsed.caseId,
      repeat: parsed.repeat,
      provider: parsed.provider,
      model: parsed.model,
      temperature: parsed.temperature,
      seed: parsed.seed,
      maxTokens: parsed.maxTokens,
      timeoutMs: parsed.timeoutMs,
      maxRetries: parsed.maxRetries,
      systemPrompt: parsed.systemPrompt,
      debounceMs: parsed.debounceMs,
    });
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function cmdInspect(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) {
    printInspectHelp();
    return 0;
  }
  if (parsed.positional.length > 0) {
    console.error(`Unexpected positional argument: "${parsed.positional[0]}"`);
    printInspectHelp();
    return 2;
  }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printInspectHelp();
    return 2;
  }

  try {
    const summary = await inspectSuite({
      suitePath: resolve(parsed.suite),
      caseId: parsed.caseId,
    });

    if (parsed.json) {
      console.log(JSON.stringify(inspectToJson(summary), null, 2));
      const anyInvalid = summary.cases.some((c) => c.provenanceStatus === "invalid");
      return anyInvalid ? 2 : 0;
    }

    console.log(`Desurf inspect \u2014 suite "${summary.suiteName}"\n`);
    let anyInvalid = false;
    for (const c of summary.cases) {
      const state = c.cassetteState.toUpperCase();
      // v1 sidecars never fingerprinted the output \u2014 say so instead of
      // implying it was verified.
      const savedLine =
        c.outputFresh === null
          ? "unverified (v1 sidecar \u2014 re-seal to fingerprint the output)"
          : c.outputFresh
            ? "fresh"
            : "STALE (modified after seal/record)";
      console.log(`\u2022 ${c.caseId}`);
      console.log(`  cassette: ${state}`);
      console.log(`  output:   ${c.outputPath}`);
      console.log(`  meta:     ${c.metaPresent ? c.metaPath : "(none)"}`);
      if (c.provenanceStatus === "unsealed") {
        console.log(`  status:   UNSEALED \u2014 no provenance; prompt/input drift cannot be detected`);
        console.log(`  next:     run \`desurf seal --suite <path>\` to establish offline provenance`);
      } else if (c.provenanceStatus === "fresh") {
        console.log(`  prompt:   fresh`);
        console.log(`  input:    fresh`);
        console.log(`  saved:    ${savedLine}`);
        console.log(`  status:   FRESH \u2014 fingerprints match current prompt and input${c.outputFresh === null ? "" : " and output"}`);
      } else if (c.provenanceStatus === "stale") {
        console.log(`  prompt:   ${c.promptFresh ? "fresh" : "STALE"}`);
        console.log(`  input:    ${c.inputFresh ? "fresh" : "STALE"}`);
        if (c.outputFresh !== null) console.log(`  saved:    ${savedLine}`);
        console.log(`  status:   STALE \u2014 ${c.detail ?? "fingerprints do not match"}`);
        console.log(`  next:     restore input/prompt/output or re-seal / re-record`);
      } else {
        anyInvalid = true;
        console.log(`  status:   INVALID \u2014 ${c.detail ?? "malformed provenance metadata"}`);
        console.log(`  next:     repair or re-seal / re-record the cassette metadata`);
      }
      console.log();
    }
    return anyInvalid ? 2 : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error("Desurf error:", msg);
    }
    return 2;
  }
}

function inspectToJson(summary: InspectSummary): object {
  return {
    suite: summary.suiteName,
    cases: summary.cases.map((c) => ({
      caseId: c.caseId,
      outputPath: c.outputPath,
      metaPath: c.metaPath,
      cassetteState: c.cassetteState,
      metaPresent: c.metaPresent,
      promptFresh: c.promptFresh,
      inputFresh: c.inputFresh,
      outputFresh: c.outputFresh,
      provenanceStatus: c.provenanceStatus,
      detail: c.detail ?? null,
    })),
  };
}

async function main(): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printRootHelp();
    return 2;
  }

  if (parsed.command === "version") {
    console.log(getVersion());
    return 0;
  }

  if (
    parsed.command === "help" ||
    (parsed.help && !["test", "init", "record", "seal", "inspect", "watch"].includes(parsed.command))
  ) {
    printRootHelp();
    return 0;
  }

  switch (parsed.command) {
    case "test":
      return cmdTest(parsed);
    case "init":
      return cmdInit(parsed);
    case "record":
      return cmdRecord(parsed);
    case "seal":
      return cmdSeal(parsed);
    case "inspect":
      return cmdInspect(parsed);
    case "watch":
      return cmdWatch(parsed);
    default:
      console.error(`Unknown command: ${parsed.command}`);
      printRootHelp();
      return 2;
  }
}

process.stdout.on("error", (err: any) => {
  if (err && (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")) {
    process.exit(0);
  }
});

process.stderr.on("error", (err: any) => {
  if (err && (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")) {
    process.exit(0);
  }
});

main().then(
  (code) => {
    // Set the exit code WITHOUT force-killing the process: process.exit()
    // discards pending async stdout writes, which deterministically truncates
    // piped `--json` output at the OS pipe buffer size (65,536 bytes on Linux)
    // while still reporting success. Letting the event loop drain guarantees
    // every byte reaches the consumer (jq, CI log capture, tee, ...).
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
);