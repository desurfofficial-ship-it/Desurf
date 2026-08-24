#!/usr/bin/env node
/**
 * Desurf CLI — Stage 1
 * Parses args, runs the suite, prints results, sets exit code.
 * Contains no evaluation logic.
 */

import { resolve } from "node:path";
import { runSuite } from "./runner.js";
import type { TestResult } from "./types.js";

function printUsage(): void {
  console.log(`Desurf — offline-first prompt regression testing

Usage:
  desurf test --suite <path> [--case <id>]

Options:
  --suite <path>   Path to suite directory (or suite.json)
  --case <id>      Run only the named test case

Exit codes:
  0  all tests PASS
  1  one or more tests failed assertions
  2  execution / configuration / tool error
`);
}

function parseArgs(argv: string[]): {
  command: string;
  suite?: string;
  caseId?: string;
} {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { command: "help" };
  }

  const command = args[0];
  let suite: string | undefined;
  let caseId: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--suite" && args[i + 1]) {
      suite = args[++i];
    } else if (a === "--case" && args[i + 1]) {
      caseId = args[++i];
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return { command, suite, caseId };
}

function formatResult(r: TestResult): string {
  if (r.error) {
    return `✗ ${r.caseId}\n  ERROR\n  ${r.error}`;
  }
  if (r.passed) {
    return `✓ ${r.caseId}\n  PASS`;
  }
  const failures = r.assertionResults
    .filter((a) => !a.passed)
    .map((a) => `    - ${a.message}`)
    .join("\n");
  return `✗ ${r.caseId}\n  FAIL\n${failures}`;
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printUsage();
    return 2;
  }

  if (parsed.command === "help" || parsed.command !== "test") {
    printUsage();
    return parsed.command === "help" ? 0 : 2;
  }

  if (!parsed.suite) {
    console.error("Missing required option: --suite <path>");
    printUsage();
    return 2;
  }

  const suitePath = resolve(parsed.suite);

  try {
    const summary = await runSuite({
      suitePath,
      caseId: parsed.caseId,
    });

    console.log("Desurf\n");
    for (const r of summary.results) {
      console.log(formatResult(r));
      console.log();
    }

    console.log(
      `Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.errors} error`
    );

    if (summary.errors > 0) return 2;
    if (summary.failed > 0) return 1;
    return 0;
  } catch (err) {
    console.error(
      "Desurf error:",
      err instanceof Error ? err.message : String(err)
    );
    return 2;
  }
}

main().then((code) => {
  process.exit(code);
});
