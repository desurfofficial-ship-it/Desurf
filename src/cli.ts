#!/usr/bin/env node
/**
 * Desurf CLI — Stage 2
 * Parses args (including --repeat), runs the suite, prints reliability, sets exit code.
 * Contains no evaluation or classification logic.
 */

import { resolve } from "node:path";
import { runSuite } from "./runner.js";
import type { CaseReliability } from "./types.js";

function printUsage(): void {
  console.log(`Desurf — offline-first prompt regression testing

Usage:
  desurf test --suite <path> [--case <id>] [--repeat <n>]

Options:
  --suite <path>   Path to suite directory (or suite.json)
  --case <id>      Run only the named test case
  --repeat <n>     Execute each case N times (default 1)

Exit codes:
  0  all tests PASS
  1  quality gate failure (FLAKY or REGRESSION)
  2  execution / configuration / tool error
`);
}

function parseArgs(argv: string[]): {
  command: string;
  suite?: string;
  caseId?: string;
  repeat?: number;
} {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return { command: "help" };
  }

  const command = args[0];
  let suite: string | undefined;
  let caseId: string | undefined;
  let repeat: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--suite" && args[i + 1]) {
      suite = args[++i];
    } else if (a === "--case" && args[i + 1]) {
      caseId = args[++i];
    } else if (a === "--repeat" && args[i + 1]) {
      const n = Number(args[++i]);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--repeat must be a positive integer, got: ${args[i]}`);
      }
      repeat = n;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option: ${a}`);
    }
  }

  return { command, suite, caseId, repeat };
}

function formatCase(c: CaseReliability): string {
  const total = c.executions.length;
  const mark =
    c.state === "PASS" ? "✓" : c.state === "ERROR" ? "✗" : "✗";

  let body = `${mark} ${c.caseId}\n  ${c.state}`;
  if (total > 1) {
    body += `\n  ${c.passCount}/${total} passed`;
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
    }
  }

  return body;
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
      repeat: parsed.repeat,
    });

    console.log("Desurf\n");
    for (const c of summary.cases) {
      console.log(formatCase(c));
      console.log();
    }

    console.log(
      `Results: ${summary.passed} passed, ${summary.flaky} flaky, ${summary.regression} regression, ${summary.errors} error`
    );

    if (summary.errors > 0) return 2;
    if (summary.flaky > 0 || summary.regression > 0) return 1;
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
