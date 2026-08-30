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
  return "0.3.0";
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
  --repeat <n>         Execute each case N times (default 1)
  --provider <name>    offline (default) | openrouter
  --model <id>         Model id for live providers (default: openai/gpt-4o-mini)
  --verbose            Extra diagnostic output (no secrets)
  --json               Machine-readable JSON on stdout (diagnostics on stderr)
  --help, -h           Show this help

Environment (openrouter only):
  OPENROUTER_API_KEY   API key for OpenRouter (never printed)

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
  desurf record --suite <path> --provider openrouter [options]

Options:
  --suite <path>       Path to suite directory (or suite.json) (required)
  --provider <name>    Must be a live provider (openrouter). offline is rejected
  --model <id>         Model id (default: openai/gpt-4o-mini)
  --case <id>          Record only the named test case
  --force              Overwrite existing non-empty output files
  --help, -h           Show this help

Environment:
  OPENROUTER_API_KEY   Required for openrouter (never printed)

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
  - Hashes current input and prompt files and writes <outputPath>.desurf sidecar.
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
  version?: boolean;
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

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--version" || a === "-v") {
      result.version = true;
    }
  }
  if (result.version) {
    result.command = "version";
    return result;
  }

  let i = 0;
  const first = args[0];
  if (first === "--help" || first === "-h") {
    result.help = true;
    result.command = "help";
    return result;
  }

  result.command = first;
  i = 1;

  while (i < args.length) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      result.help = true;
      i++;
    } else if (a === "--suite" && args[i + 1]) {
      result.suite = args[++i];
      i++;
    } else if (a === "--case" && args[i + 1]) {
      result.caseId = args[++i];
      i++;
    } else if (a === "--repeat" && args[i + 1]) {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--repeat must be a positive integer, got: ${args[i]}`);
      }
      result.repeat = n;
      i++;
    } else if (a === "--provider" && args[i + 1]) {
      result.provider = args[++i];
      i++;
    } else if (a === "--model" && args[i + 1]) {
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
  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printRecordHelp();
    return 2;
  }
  if (!parsed.provider) {
    console.error("Missing required option: --provider <name> (e.g. openrouter)");
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
      "record requires a live provider (e.g. openrouter). Offline provider cannot capture new outputs."
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
        console.log(`  status:   FRESH — fingerprints match current prompt and input`);
      } else if (c.provenanceStatus === "stale") {
        console.log(`  prompt:   ${c.promptFresh ? "fresh" : "STALE"}`);
        console.log(`  input:    ${c.inputFresh ? "fresh" : "STALE"}`);
        console.log(`  status:   STALE — ${c.detail ?? "fingerprints do not match"}`);
        console.log(`  next:     restore input/prompt or re-seal / re-record`);
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

main().then((code) => {
  process.exit(code);
});
