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
import { recordSuite, recordExitCode } from "./record.js";
import {
  listHistory,
  pickEntry,
  acceptSnapshot,
  revertToBackup,
  HistoryError,
} from "./history.js";
import { loadSuite } from "./offline.js";
import { unifiedDiff } from "./diff.js";
import { isatty } from "node:tty";
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
  return "0.7.0";
}

function printRootHelp(): void {
  console.log(`Desurf — offline-first prompt regression testing

Usage:
  desurf <command> [options]

Commands:
  test      Run a suite against offline saved outputs or a live provider
  init      Create a minimal runnable offline suite
  record    Capture live output; propose drift (never mutates baseline)
  accept    Promote a history snapshot to the baseline cassette
  revert    Restore a baseline from a history backup snapshot
  diff      Show unified diff for a pending record snapshot
  history   List cassette history snapshots for a suite
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
  console.log(`desurf test — run a behavioral contract suite

Usage:
  desurf test --suite <path> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --case <id>          Run only the named test case
  --repeat <n>         Execute each case N times (default 1; max 1000, or 100 with live providers)
  --provider <name>    offline (default) | openrouter | openai | anthropic | gemini
  --model <id>         Model id for live providers (uses provider default if omitted)
  --temperature <n>    Sampling temperature 0–2 (default 0 = deterministic; see note below)
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
  an identical prompt could legitimately produce a different output — and the
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
  console.log(`desurf init — create a minimal runnable offline suite

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
  console.log(`desurf record — capture live provider output and classify vs baseline

Usage:
  desurf record --suite <path> --provider <name> [options]

Options:
  --suite <path>         Path to suite directory (or suite.json) (required)
  --provider <name>      openrouter | openai | anthropic | gemini (required; not offline)
  --model <id>           Model id for the live provider
  --case <id>            Record only the named test case
  --force                Accept immediately: backup baseline, then overwrite
  --fill-gaps            Only record missing/empty outputs (legacy no-flag behavior)
  --history-limit <n>    Ring-buffer cap per case (default 10; 1–100)
  --temperature <n>      Sampling temperature 0–2 (default 0)
  --seed <n>             Best-effort determinism seed
  --max-tokens <n>       Cap output length
  --timeout-ms <n>       Per-request deadline in ms
  --max-retries <n>      Retries on transient errors (default 0; max 5)
  --system-prompt <s>    System message prepended to every user message
  --json                 Machine-readable JSON on stdout
  --help, -h             Show this help

Behavior (propose mode — default):
  Capture live output. Classify as new | unchanged | drift.
  Write history snapshots for new and drift under .desurf-history/.
  NEVER modify an existing baseline unless --force.
  After drift: desurf diff, then desurf accept.

Exit codes:
  0  all cases new or unchanged (or --force/--fill-gaps with no errors)
  1  ≥1 drift (propose mode)
  2  any case error or configuration failure
`);
}

function printSealHelp(): void {
  console.log(`desurf seal — establish offline cassette provenance from existing outputs

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
  console.log(`desurf watch — re-run a suite whenever its files change

Usage:
  desurf watch --suite <path> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --case <id>          Run only the named test case
  --repeat <n>         Execute each case N times (default 1; max 1000, or 100 with live providers)
  --provider <name>    offline (default) | openrouter | openai | anthropic | gemini
  --model <id>         Model id for live providers (uses provider default if omitted)
  --temperature <n>    Sampling temperature 0–2 (default 0 = deterministic)
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
  - The iteration loop (tweak prompt → watch re-runs → see diff) is the
    fastest way to use Desurf day-to-day.
  - Cassette drift semantics depend on how the cassette was created:
      SEALED   — \`desurf seal\` (or a legacy sidecar): prompt/input drift is
                HARD drift → the run refuses to evaluate and exits 2.
      RECORDED — \`desurf record\`: prompt/input drift is SOFT drift → the
                run stays green (exit 0 unless assertions fail), re-evaluates
                the current assertions against the drifted baseline, shows a
                diff, and prints a WARNING so the drift is never silent.
      UNSEALED — no .desurf sidecar: no provenance; prompt/input drift
                cannot be detected at all (run \`desurf seal\` to enable it).
  - Ctrl+C stops the watcher with exit 0.

Exit codes:
  Same contract as \`desurf test\`: 0 PASS · 1 REGRESSION/FLAKY · 2 ERROR
  (reported per run; the watcher itself always exits 0 on stop).
`);
}

function printInspectHelp(): void {
  console.log(`desurf inspect — report cassette provenance status (read-only)

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
  fillGaps?: boolean;
  historyLimit?: number;
  entry?: string;
  all?: boolean;
  yes?: boolean;
  full?: boolean;
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
  // the version and exit 0 WITHOUT running any test — a silent-green bypass
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
      // (hex 16), "1e9" (scientific notation), and " 5 " (whitespace) —
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
      // rejected live — inconsistent (Task 13 finding). Reject loudly here.
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
    } else if (a === "--fill-gaps") {
      result.fillGaps = true;
      i++;
    } else if (a === "--history-limit") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --history-limit requires a value");
      }
      const raw = args[++i];
      const n = parseNumericFlag(raw, "history-limit", { integer: true });
      if (n < 1 || n > 100) {
        throw new Error(`--history-limit must be an integer between 1 and 100 (got ${n})`);
      }
      result.historyLimit = n;
      i++;
    } else if (a === "--entry") {
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        throw new Error("Option --entry requires a value");
      }
      result.entry = args[++i];
      i++;
    } else if (a === "--all") {
      result.all = true;
      i++;
    } else if (a === "--yes" || a === "-y") {
      result.yes = true;
      i++;
    } else if (a === "--full") {
      result.full = true;
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
  const mark = c.state === "PASS" ? "✓" : "✗";

  let body = `${mark} ${c.caseId}\n  ${c.state}`;
  if (total > 1) {
    body += `\n  ${c.passCount}/${total} passed`;
  }

  if (c.cassetteState === "unsealed") {
    body +=
      "\n  cassette: UNSEALED (no provenance — run `desurf seal` to detect prompt/input drift)";
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

  // Soft cassette drift (recorded baseline) — visible warning, not an
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
      // v0.4.3: expose the root warnings count so a soft-drift run is
      // visibly not a clean PASS (previously only case-level data existed
      // and the machine-readable verdict could say PASS while the human
      // output said WARNING).
      warnings: summary.warnings,
    },
    cases: summary.cases.map((c) => ({
      id: c.caseId,
      state: c.state,
      cassetteState: c.cassetteState,
      passCount: c.passCount,
      failCount: c.failCount,
      errorCount: c.errorCount,
      // v0.4.3: per-case warning count mirrors the human verdict.
      warnings: c.executions.reduce(
        (n, e) => n + (e.warnings ? e.warnings.length : 0),
        0
      ),
      executions: c.executions.map((e) => ({
        passed: e.passed,
        error: e.error ?? null,
        assertionFailures: e.assertionResults
          .filter((a) => !a.passed)
          .map((a) => ({
            type: a.assertion.type,
            message: a.message,
            // B3 D9: name the failing turn when present (omit for single-turn).
            ...(a.turnIndex !== undefined ? { turnIndex: a.turnIndex } : {}),
          })),
        outputPreview: e.outputPreview ?? null,
        // v0.4.3: per-execution warnings (soft drift) and the regression
        // diff are decision-relevant; the human output shows both, so the
        // JSON verdict must too. Soft drift can no longer appear as an
        // unexplained clean PASS in JSON.
        warnings: e.warnings ?? [],
        drift: e.drift ?? null,
        diff: e.diff ?? null,
        // B3 D9: per-turn results for multi-turn cases; omitted for single-turn.
        ...(e.turns
          ? {
              turns: e.turns.map((tr) => ({
                index: tr.index,
                passed: tr.passed,
                assertionResults: tr.assertionResults.map((a) => ({
                  type: a.assertion.type,
                  message: a.message,
                  passed: a.passed,
                  ...(a.turnIndex !== undefined ? { turnIndex: a.turnIndex } : {}),
                })),
                outputPreview: tr.outputPreview ?? null,
                error: tr.error ?? null,
              })),
            }
          : {}),
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
        `Each repetition is a billed network call — use the offline provider ` +
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
      // v0.4.3: when --json is requested, structured command errors must
      // be valid JSON on STDOUT (not stderr) so `desurf test --json | jq`
      // always consumes valid JSON. Exit code stays 2.
      console.log(JSON.stringify({ status: "ERROR", error: msg }, null, 2));
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
    console.error("Missing required option: --provider <name>");
    printRecordHelp();
    return 2;
  }

  try {
    const providerName = parsed.provider;
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

    const provider = createProvider({
      provider: providerName,
      model: parsed.model,
      temperature: parsed.temperature,
      seed: parsed.seed,
      maxTokens: parsed.maxTokens,
      timeoutMs: parsed.timeoutMs,
      maxRetries: parsed.maxRetries,
      systemPrompt: parsed.systemPrompt,
    });

    const summary = await recordSuite({
      suitePath: resolve(parsed.suite),
      provider,
      providerName,
      model: parsed.model,
      caseId: parsed.caseId,
      force: parsed.force === true,
      fillGaps: parsed.fillGaps === true,
      historyLimit: parsed.historyLimit,
      cliVersion: getVersion(),
    });

    const exitCode = recordExitCode(summary, {
      force: parsed.force === true,
      fillGaps: parsed.fillGaps === true,
    });

    if (parsed.json) {
      const payload = {
        command: "record",
        suite: summary.suiteName,
        provider: summary.providerName,
        model: summary.model ?? null,
        exitCode,
        summary: summary.summary,
        results: summary.results.map((r) => ({
          caseId: r.caseId,
          verdict: r.verdict,
          assertionsPassed: r.assertionsPassed ?? null,
          baselineSha256: r.baselineSha256 ?? null,
          outputSha256: r.outputSha256 ?? null,
          snapshot: r.snapshot ?? null,
          diff: r.diff ?? null,
          message: r.message,
        })),
      };
      console.log(JSON.stringify(payload, null, 2));
      return exitCode;
    }

    console.log(
      `Desurf record — suite "${summary.suiteName}" (provider ${summary.providerName}${
        summary.model ? `, model ${summary.model}` : ""
      })\n`
    );

    for (const r of summary.results) {
      const marker =
        r.verdict === "unchanged"
          ? "="
          : r.verdict === "drift"
            ? "!"
            : r.verdict === "new"
              ? "+"
              : "x";
      const label = r.verdict.toUpperCase().padEnd(9);
      console.log(`${marker} ${r.caseId.padEnd(20)} ${label}  ${r.message}`);
      if (r.snapshot) {
        console.log(`    ${r.snapshot}`);
      }
      if (r.verdict === "drift" && r.diff) {
        console.log(`\nDrift diff (${r.caseId}):\n${r.diff}\n`);
      }
      if (
        (r.verdict === "new" || r.verdict === "drift") &&
        r.assertionsPassed !== undefined &&
        r.assertionsPassed !== null
      ) {
        const pass = r.assertionsPassed ? "PASS" : "FAIL";
        console.log(
          `Contract check: ${r.caseId} — assertions ${pass} against new output`
        );
      }
    }

    const s = summary.summary;
    console.log(
      `\nSummary: ${s.unchanged} unchanged, ${s.drift} drift, ${s.new} new, ${s.error} error`
    );
    if (s.drift > 0 && !parsed.force) {
      console.log(
        `Next: \`desurf diff --suite ${parsed.suite} --case <id>\` to inspect, then\n` +
          `      \`desurf accept --suite ${parsed.suite} --case <id>\` (or \`--all\`).`
      );
    }

    return exitCode;
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

    console.log(`Desurf seal — suite "${summary.suiteName}"\n`);
    let anyError = false;
    for (const r of summary.results) {
      const mark =
        r.status === "sealed" ? "✓" : r.status === "skipped" ? "·" : "✗";
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

    console.log(`Desurf inspect — suite "${summary.suiteName}"\n`);
    let anyInvalid = false;
    for (const c of summary.cases) {
      const state = c.cassetteState.toUpperCase();
      // v1 sidecars never fingerprinted the output — say so instead of
      // implying it was verified.
      const savedLine =
        c.outputFresh === null
          ? "unverified (v1 sidecar — re-seal to fingerprint the output)"
          : c.outputFresh
            ? "fresh"
            : "STALE (modified after seal/record)";
      console.log(`• ${c.caseId}`);
      console.log(`  cassette: ${state}`);
      console.log(`  output:   ${c.outputPath}`);
      console.log(`  meta:     ${c.metaPresent ? c.metaPath : "(none)"}`);
      if (c.provenanceStatus === "unsealed") {
        console.log(`  status:   UNSEALED — no provenance; prompt/input drift cannot be detected`);
        console.log(`  next:     run \`desurf seal --suite <path>\` to establish offline provenance`);
      } else if (c.provenanceStatus === "fresh") {
        console.log(`  prompt:   fresh`);
        console.log(`  input:    fresh`);
        console.log(`  saved:    ${savedLine}`);
        console.log(`  status:   FRESH — fingerprints match current prompt and input${c.outputFresh === null ? "" : " and output"}`);
      } else if (c.provenanceStatus === "stale") {
        console.log(`  prompt:   ${c.promptFresh ? "fresh" : "STALE"}`);
        console.log(`  input:    ${c.inputFresh ? "fresh" : "STALE"}`);
        if (c.outputFresh !== null) console.log(`  saved:    ${savedLine}`);
        console.log(`  status:   STALE — ${c.detail ?? "fingerprints do not match"}`);
        console.log(`  next:     restore input/prompt/output or re-seal / re-record`);
      } else {
        anyInvalid = true;
        console.log(`  status:   INVALID — ${c.detail ?? "malformed provenance metadata"}`);
        console.log(`  next:     repair or re-seal / re-record the cassette metadata`);
      }
      console.log();
    }
    return anyInvalid ? 2 : 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      // v0.4.3: structured ERROR JSON on stdout for --json consumers.
      console.log(JSON.stringify({ status: "ERROR", error: msg }, null, 2));
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


function printHistoryHelp(): void {
  console.log(`desurf history — list cassette history snapshots

Usage:
  desurf history --suite <path> [--case <id>] [--json]

Exit codes:
  0  success
  1  no history for the requested scope
  2  corrupt store or configuration error
`);
}

function printDiffHelp(): void {
  console.log(`desurf diff — show unified diff for a pending record snapshot

Usage:
  desurf diff --suite <path> --case <id> [--entry <n|file>] [--full]

Exit codes:
  0  diff produced
  1  nothing to diff
  2  corrupt store / unknown case
`);
}

function printAcceptHelp(): void {
  console.log(`desurf accept — promote a history snapshot to the baseline

Usage:
  desurf accept --suite <path> [--case <id> | --all] [--entry <n|file>] [--yes] [--json]

--yes is always required (no interactive prompt; zero-dependency policy).

Exit codes:
  0  every requested case accepted
  1  nothing to accept
  2  integrity / config / missing --yes
`);
}

function printRevertHelp(): void {
  console.log(`desurf revert — restore a baseline from a history backup

Usage:
  desurf revert --suite <path> --case <id> [--entry <n|file>] [--yes]

--yes is always required (no interactive prompt; zero-dependency policy).

Exit codes:
  0  restored
  1  nothing to revert
  2  integrity / config / missing --yes
`);
}

async function cmdHistory(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) { printHistoryHelp(); return 0; }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printHistoryHelp();
    return 2;
  }
  try {
    const suite = await loadSuite(resolve(parsed.suite));
    const listed = await listHistory(suite.rootDir, parsed.caseId);
    for (const item of listed) {
      if (item.rebuilt) {
        console.error(`WARNING: index.json missing; rebuilt from ${item.entries.length} snapshot files`);
      }
    }
    const withEntries = listed.filter((c) => c.entries.length > 0);
    if (parsed.json) {
      console.log(JSON.stringify({
        command: "history",
        suite: suite.name,
        cases: listed.map((c) => ({
          caseId: c.caseId,
          pendingReview: c.pendingReview,
          entries: c.entries,
        })),
      }, null, 2));
    } else {
      if (withEntries.length === 0) {
        console.log(`No history for suite "${suite.name}"`);
      } else {
        for (const c of listed) {
          if (c.entries.length === 0) continue;
          const pending = c.entries.filter((e) => e.kind === "record" && e.acceptedAt === null).length;
          console.log(`${c.caseId}  (${c.entries.length} snapshots, ${pending} pending review)`);
          c.entries.forEach((e, i) => {
            const acc = e.acceptedAt ? `accepted: ${e.acceptedAt}` : "accepted: no";
            const verd = e.verdictAtCapture ?? "";
            const ap = e.assertionsPassed === true ? "assertions PASS" : e.assertionsPassed === false ? "assertions FAIL" : "";
            console.log(`  ${i + 1}. ${e.file}   ${e.kind}  ${verd}  ${e.outputSha256.slice(0, 8)}…  ${ap}  ${acc}`);
          });
        }
      }
    }
    if (withEntries.length === 0) return 1;
    return 0;
  } catch (err) {
    if (err instanceof HistoryError && err.code === "corrupt-index") {
      console.error(err.message);
      return 2;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function cmdDiff(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) { printDiffHelp(); return 0; }
  if (!parsed.suite || !parsed.caseId) {
    console.error("Missing required options: --suite <path> --case <id>");
    printDiffHelp();
    return 2;
  }
  try {
    const suite = await loadSuite(resolve(parsed.suite));
    const tc = suite.cases.find((c) => c.id === parsed.caseId);
    if (!tc) {
      console.error(`No test case with id "${parsed.caseId}" in suite "${suite.name}"`);
      return 2;
    }
    let picked;
    try {
      picked = await pickEntry(suite.rootDir, parsed.caseId!, parsed.entry, { kind: "record" });
    } catch (err) {
      if (err instanceof HistoryError && err.code === "not-found") {
        console.error(err.message);
        return 1;
      }
      throw err;
    }
    const { snapshot, entry } = picked;
    let baselineText = "";
    try {
      const { readFile } = await import("node:fs/promises");
      baselineText = await readFile(tc.outputPath, "utf8");
    } catch {
      baselineText = "";
    }
    console.log(`Diff — case ${parsed.caseId}`);
    console.log(`  verdict: ${snapshot.verdictAtCapture}  recordedAt: ${snapshot.recordedAt}`);
    console.log(`  provider: ${snapshot.provider}  model: ${snapshot.model}`);
    console.log(`  assertionsPassed: ${snapshot.assertionsPassed}`);
    console.log(`  snapshot: ${entry.file}`);
    if (!baselineText) {
      console.log("\n(no baseline on disk — showing snapshot output only)\n");
      console.log(snapshot.output);
    } else {
      // B3: when both sides are transcript JSON, render per-turn hunks (T13).
      const maxLines = parsed.full ? 2000 : 200;
      let d = "";
      try {
        const baseTr = JSON.parse(baselineText) as { turns?: Array<{ user?: string; output?: string }> };
        const snapTr = JSON.parse(snapshot.output) as { turns?: Array<{ user?: string; output?: string }> };
        if (Array.isArray(baseTr.turns) && Array.isArray(snapTr.turns)) {
          const n = Math.max(baseTr.turns.length, snapTr.turns.length);
          const parts: string[] = [];
          for (let i = 0; i < n; i++) {
            const bo = baseTr.turns[i]?.output ?? "";
            const so = snapTr.turns[i]?.output ?? "";
            const hunk = unifiedDiff(bo, so, maxLines);
            parts.push(`== turn ${i} ==`);
            parts.push(hunk || "(no change)");
          }
          d = parts.join("\n");
        }
      } catch {
        // not transcript JSON — fall through to whole-file diff
      }
      if (!d) {
        d = unifiedDiff(baselineText, snapshot.output, maxLines);
      }
      console.log("\n" + (d || "(no textual diff — outputs equal after normalization)"));
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function cmdAccept(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) { printAcceptHelp(); return 0; }
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printAcceptHelp();
    return 2;
  }
  if (!parsed.caseId && !parsed.all) {
    console.error("Specify --case <id> or --all");
    printAcceptHelp();
    return 2;
  }
  // E13: non-TTY without --yes
  if (!parsed.yes && !isatty(process.stdin.fd)) {
    console.error("refusing to accept without --yes in non-interactive mode");
    return 2;
  }

  try {
    const suite = await loadSuite(resolve(parsed.suite));
    const targets = parsed.all
      ? suite.cases
      : suite.cases.filter((c) => c.id === parsed.caseId);
    if (!parsed.all && targets.length === 0) {
      console.error(`No test case with id "${parsed.caseId}" in suite "${suite.name}"`);
      return 2;
    }

    // Interactive confirmation for TTY without --yes: print and require --yes for simplicity
    // Spec says ask for confirmation when TTY; we require typing by using --yes always for safety in automation
    if (!parsed.yes && isatty(process.stdin.fd)) {
      // Print pending diffs and ask — without readline dep, require --yes even on TTY for zero-deps
      console.error("Confirmation required: re-run with --yes to accept (zero-deps CLI; no interactive prompt library).");
      return 2;
    }

    const accepted: Array<{ caseId: string; snapshot: string; backup: string | null }> = [];
    const nothingToAccept: string[] = [];
    const errors: Array<{ caseId: string; message: string }> = [];

    for (const tc of targets) {
      try {
        const result = await acceptSnapshot(
          suite.rootDir,
          tc.id,
          tc.outputPath,
          tc.input ?? tc.turns?.[0]?.user ?? "",
          tc.prompt,
          {
            entry: parsed.entry,
            historyLimit: parsed.historyLimit,
            cliVersion: getVersion(),
          }
        );
        accepted.push(result);
        console.log(
          `Accepted ${result.caseId} — baseline updated from snapshot ${result.snapshot}` +
            (result.backup ? ` (previous baseline backed up to ${result.backup})` : "") +
            `. Run \`desurf test --suite ${parsed.suite}\` to confirm the contract.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof HistoryError && err.code === "not-found") {
          nothingToAccept.push(tc.id);
        } else {
          errors.push({ caseId: tc.id, message: msg });
          console.error(`${tc.id}: ${msg}`);
        }
      }
    }

    if (parsed.json) {
      const exitCode = errors.length > 0 ? 2 : accepted.length === 0 ? 1 : 0;
      console.log(JSON.stringify({
        command: "accept",
        suite: suite.name,
        accepted,
        nothingToAccept,
        errors,
        exitCode,
      }, null, 2));
      return exitCode;
    }

    if (errors.length > 0) return 2;
    if (accepted.length === 0) {
      console.log("nothing to accept");
      return 1;
    }
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function cmdRevert(parsed: ParsedArgs): Promise<number> {
  if (parsed.help) { printRevertHelp(); return 0; }
  if (!parsed.suite || !parsed.caseId) {
    console.error("Missing required options: --suite <path> --case <id>");
    printRevertHelp();
    return 2;
  }
  if (!parsed.yes && !isatty(process.stdin.fd)) {
    console.error("refusing to revert without --yes in non-interactive mode");
    return 2;
  }
  if (!parsed.yes && isatty(process.stdin.fd)) {
    console.error("Confirmation required: re-run with --yes to revert (zero-deps CLI).");
    return 2;
  }

  try {
    const suite = await loadSuite(resolve(parsed.suite));
    const tc = suite.cases.find((c) => c.id === parsed.caseId);
    if (!tc) {
      console.error(`No test case with id "${parsed.caseId}" in suite "${suite.name}"`);
      return 2;
    }
    try {
      const result = await revertToBackup(suite.rootDir, tc.id, tc.outputPath, {
        entry: parsed.entry,
      });
      console.log(
        `Reverted ${result.caseId} from ${result.restoredFrom}. Run \`desurf test --suite ${parsed.suite}\` to confirm.`
      );
      return 0;
    } catch (err) {
      if (err instanceof HistoryError && err.code === "not-found") {
        console.error(err.message);
        return 1;
      }
      throw err;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
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
    (parsed.help && !["test", "init", "record", "accept", "revert", "diff", "history", "seal", "inspect", "watch"].includes(parsed.command))
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
    case "accept":
      return cmdAccept(parsed);
    case "revert":
      return cmdRevert(parsed);
    case "diff":
      return cmdDiff(parsed);
    case "history":
      return cmdHistory(parsed);
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
