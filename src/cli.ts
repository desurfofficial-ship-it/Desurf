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
