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
  return "0.4.0";
}

function printRootHelp(): void {
  console.log(`Desurf — offline-first prompt regression testing

Usage:
  desurf <command> [options]

Commands:
  test      Run a suite against offline saved outputs or a live provider
  init      Create a minimal runnable offline suite
  record    Capture live provider outputs into suite output files
  seal      Establish offline cassette provenance from existing output files
  inspect   Report cassette provenance status (read-only, offline)

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
  --verbose            Extra diagnostic output (no secrets)
  --json               Machine-readable JSON on stdout (diagnostics on stderr)
  --help, -h           Show this help

Environment (live providers only):
  OPENROUTER_API_KEY   API key for openrouter (never printed)
  OPENAI_API_KEY       API key for openai (never printed)
  ANTHROPIC_API_KEY    API key for anthropic (never printed)
  GEMINI_API_KEY       API key for gemini (or GOOGLE_API_KEY) (never printed)

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
  console.log(`desurf record — capture live provider output into suite files

Usage:
  desurf record --suite <path> --provider <name> [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --provider <name>    Live provider: openrouter | openai | anthropic | gemini (required)
  --model <id>         Model id (uses provider default if omitted)
  --case <id>          Record only the named test case
  --force              Overwrite existing non-empty output files
  --help, -h           Show this help

Environment:
  OPENROUTER_API_KEY   Required for openrouter (never printed)
  OPENAI_API_KEY       Required for openai (never printed)
  ANTHROPIC_API_KEY    Required for anthropic (never printed)
  GEMINI_API_KEY       Required for gemini (or GOOGLE_API_KEY) (never printed)

Notes:
  - Does not evaluate assertions; only captures provider output.
  - Existing non-empty outputs are skipped unless --force is set.
  - Partial success is preserved if a later case fails.

Exit codes:
  0  all selected cases recorded or intentionally skipped
  2  configuration / provider / unknown-case error, or any case failed to record
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
  verbose?: boolean;
  json?: boolean;
  positional: string[];
};

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
    } else if (a === "--force") {
      result.force = true;
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
    (parsed.help && !["test", "init", "record", "seal", "inspect"].includes(parsed.command))
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

