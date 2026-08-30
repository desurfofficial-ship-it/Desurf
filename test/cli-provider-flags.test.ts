/**
 * CLI generation-flag validation.
 *
 * Task 14: `--timeout-ms` must reject values outside [1000, 600000] at
 * parse time in BOTH offline and live modes, with the same diagnostic.
 * Previously only the lower bound was checked in the CLI; the upper bound
 * was enforced only on the live-provider path, so `--timeout-ms 700000`
 * was accepted offline (exit 0) and rejected live.
 */
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";

const NO_KEYS = {
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GEMINI_API_KEY: "",
  GOOGLE_API_KEY: "",
  OPENROUTER_API_KEY: "",
};

function runCli(
  args: string[],
  envOverrides: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...NO_KEYS, ...envOverrides },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const RANGE_RE = /--timeout-ms must be between 1000 and 600000 milliseconds/;
const INTEGER_RE = /--timeout-ms must be a non-negative decimal integer/;

describe("CLI provider flags — timeout-ms range (Task 14)", { timeout: 25000 }, () => {
  it("--timeout-ms 500 (below min) exits 2 with unified range diagnostic", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "500",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
    expect(r.stderr).toMatch(/got 500/);
  });

  it("--timeout-ms 999 (lower boundary) exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "999",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
    expect(r.stderr).toMatch(/got 999/);
  });

  it("--timeout-ms 1000 (exact lower) is accepted and reaches the live provider", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--provider",
      "openai",
      "--timeout-ms",
      "1000",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toMatch(RANGE_RE);
    expect(r.stderr + r.stdout).toMatch(/missing API key/i);
  });

  it("--timeout-ms 600000 (exact upper) is accepted and reaches the live provider", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--provider",
      "openai",
      "--timeout-ms",
      "600000",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).not.toMatch(RANGE_RE);
    expect(r.stderr + r.stdout).toMatch(/missing API key/i);
  });

  it("--timeout-ms 600001 (upper-bound regression) exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--provider",
      "openai",
      "--timeout-ms",
      "600001",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
    expect(r.stderr).toMatch(/got 600001/);
  });

  it("--timeout-ms 700000 (clearly invalid) exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--provider",
      "openai",
      "--timeout-ms",
      "700000",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
    expect(r.stderr).toMatch(/got 700000/);
  });

  it("--timeout-ms 700000 OFFLINE exits 2 (Task 13 finding: was exit 0)", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "700000",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
    expect(r.stderr).toMatch(/got 700000/);
  });

  it("--timeout-ms 600001 OFFLINE exits 2 (uniform with live)", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "600001",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
  });

  it("--timeout-ms 600000 OFFLINE is accepted (exit 0 PASS)", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "600000",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/PASS/);
    expect(r.stderr).not.toMatch(RANGE_RE);
  });

  it("out-of-range --timeout-ms is rejected before any live provider request", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--provider",
      "openai",
      "--timeout-ms",
      "700000",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(RANGE_RE);
    expect(r.stderr + r.stdout).not.toMatch(/missing API key/i);
  });

  it("--timeout-ms 1000 OFFLINE is accepted (lower boundary, exit 0)", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "1000",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/PASS/);
  });
});

describe("CLI provider flags — numeric hardening intact", { timeout: 25000 }, () => {
  it("--timeout-ms 1e9 (scientific) is rejected as non-integer syntax", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "1e9",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(INTEGER_RE);
    expect(r.stderr).not.toMatch(RANGE_RE);
  });

  it("--timeout-ms 0x10 (hex) is rejected as non-integer syntax", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "0x10",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(INTEGER_RE);
  });

  it("--timeout-ms abc is rejected as non-integer syntax", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--timeout-ms",
      "abc",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(INTEGER_RE);
  });
});

describe("CLI provider flags — other bounds unchanged", { timeout: 25000 }, () => {
  it("--max-retries 6 still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--max-retries",
      "6",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--max-retries is capped at 5/);
  });

  it("--temperature 3 still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--temperature",
      "3",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--temperature must be between 0 and 2/);
  });

  it("--max-tokens 0 still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--max-tokens",
      "0",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--max-tokens must be a positive integer/);
  });

  it("--seed 1.5 still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--seed",
      "1.5",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--seed must be a non-negative decimal integer/);
  });

  it("--temperature 1e1 (scientific) still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--temperature",
      "1e1",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--temperature must be a decimal number/);
  });

  it("--max-retries 0x10 (hex) still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--max-retries",
      "0x10",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--max-retries must be a non-negative decimal integer/);
  });

  it("--max-tokens 1e3 (scientific) still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--max-tokens",
      "1e3",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--max-tokens must be a non-negative decimal integer/);
  });

  it("--seed 0x10 (hex) still exits 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--seed",
      "0x10",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--seed must be a non-negative decimal integer/);
  });
});
