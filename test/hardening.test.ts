import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { evaluateAssertion } from "../src/assertions.js";
import { atomicWriteFile } from "../src/fs-utils.js";
import { readFile } from "node:fs/promises";

function runCli(
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
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

describe("Hardening & Edge Cases (D-01, D-02, D-03)", { timeout: 35000 }, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-hardening-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("D-01: False-Green & -v Ambiguity Prevention", () => {
    it("top-level `desurf --version` and `desurf -v` print version and exit 0", async () => {
      const v1 = await runCli(["--version"]);
      expect(v1.code).toBe(0);
      expect(v1.stdout.trim()).toBe("0.4.0");

      const v2 = await runCli(["-v"]);
      expect(v2.code).toBe(0);
      expect(v2.stdout.trim()).toBe("0.4.0");
    });

    it("`desurf test --suite <valid> -v` runs the test in verbose mode and does NOT just print version", async () => {
      const r = await runCli(["test", "--suite", "fixtures/basic", "-v"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/Desurf/);
      expect(r.stdout).toMatch(/PASS/);
      expect(r.stdout).toMatch(/Results: 1 passed/);
      expect(r.stdout.trim()).not.toBe("0.4.0");
    });

    it("`desurf test --suite <failing> -v` runs the test, evaluates assertions, and exits 1 (never false-green 0)", async () => {
      const r = await runCli([
        "test",
        "--suite",
        "examples/support-agent",
        "--case",
        "support-classifier-regressed",
        "-v",
      ]);
      expect(r.code).toBe(1);
      expect(r.stdout).toMatch(/REGRESSION/);
      expect(r.stdout).toMatch(/Results: 0 passed, 0 flaky, 1 regression/);
      expect(r.stdout.trim()).not.toBe("0.4.0");
    });

    it("`desurf test --suite <nonexistent> -v` reports error and exits 2", async () => {
      const r = await runCli(["test", "--suite", join(dir, "nonexistent"), "-v"]);
      expect(r.code).toBe(2);
      expect(r.stdout.trim()).not.toBe("0.4.0");
    });

    it("`desurf test --suite <valid> --version` rejects unknown option --version with exit 2", async () => {
      const r = await runCli(["test", "--suite", "fixtures/basic", "--version"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/Unknown option: --version/);
    });

    it("`desurf init <dir> -v` rejects unknown option -v with exit 2", async () => {
      const r = await runCli(["init", join(dir, "init-v"), "-v"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/Unknown option: -v/);
    });

    it("`desurf seal --suite <dir> -v` rejects unknown option -v with exit 2", async () => {
      const r = await runCli(["seal", "--suite", "fixtures/basic", "-v"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/Unknown option: -v/);
    });

    it("`desurf inspect --suite <dir> -v` rejects unknown option -v with exit 2", async () => {
      const r = await runCli(["inspect", "--suite", "fixtures/basic", "-v"]);
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/Unknown option: -v/);
    });
  });

  describe("D-02: Large JSON Output (>65KB) Flushes Completely Without Truncation", () => {
    it("handles large JSON output (>65KB) through stdout pipe without corruption", async () => {
      const suiteDir = join(dir, "large-suite");
      const inputsDir = join(suiteDir, "inputs");
      const promptsDir = join(suiteDir, "prompts");
      const outputsDir = join(suiteDir, "outputs");

      await mkdir(inputsDir, { recursive: true });
      await mkdir(promptsDir, { recursive: true });
      await mkdir(outputsDir, { recursive: true });

      await writeFile(join(inputsDir, "input.txt"), "hello", "utf8");
      await writeFile(join(promptsDir, "prompt.txt"), "process", "utf8");
      await writeFile(
        join(outputsDir, "output.json"),
        JSON.stringify({ status: "ok", role: "assistant" }),
        "utf8"
      );

      // Create 250 cases so the resulting summary JSON is > 100KB
      const cases = [];
      for (let i = 0; i < 250; i++) {
        cases.push({
          id: `case-${i.toString().padStart(4, "0")}-with-descriptive-long-identifier-for-stress-testing`,
          input: "inputs/input.txt",
          prompt: "prompts/prompt.txt",
          output: "outputs/output.json",
          assertions: [
            {
              type: "required",
              value: "assistant",
              caseSensitive: true,
            },
            {
              type: "regex",
              pattern: '"status"\\s*:\\s*"ok"',
            },
          ],
        });
      }

      const suiteJson = {
        name: "large-stress-suite",
        cases,
      };

      await writeFile(
        join(suiteDir, "suite.json"),
        JSON.stringify(suiteJson, null, 2),
        "utf8"
      );

      const r = await runCli(["test", "--suite", suiteDir, "--json"]);
      expect(r.code).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(65536);

      // Verify the entire output parses cleanly as JSON
      const parsed = JSON.parse(r.stdout);
      expect(parsed.status).toBe("PASS");
      expect(parsed.suite).toBe("large-stress-suite");
      expect(parsed.counts.passed).toBe(250);
      expect(parsed.cases.length).toBe(250);
      expect(parsed.cases[249].state).toBe("PASS");
    });
  });

  describe("D-03: Regex ReDoS Protection & Timeout Handling", () => {
    it("safely times out catastrophic backtracking regex without hanging", () => {
      const evilPattern = "(a+)+$";
      const adversarialText = "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!"; // Would cause 2^28 operations

      const start = Date.now();
      const result = evaluateAssertion(
        { type: "regex", pattern: evilPattern },
        { text: adversarialText }
      );
      const elapsed = Date.now() - start;

      expect(result.passed).toBe(false);
      expect(result.message).toMatch(/timed out/i);
      expect(elapsed).toBeLessThan(3000);
    });

    it("evaluates standard valid regex correctly and quickly", () => {
      const result = evaluateAssertion(
        { type: "regex", pattern: "billing|technical" },
        { text: "This is a technical support issue." }
      );
      expect(result.passed).toBe(true);
      expect(result.message).toMatch(/Regex matched/);
    });
  });

  describe("Atomic Writes & File Resilience", () => {
    it("atomicWriteFile writes complete content safely", async () => {
      const testFile = join(dir, "atomic-test.txt");
      const content = "Secure content: " + "X".repeat(5000);

      await atomicWriteFile(testFile, content, "utf8");
      const readBack = await readFile(testFile, "utf8");
      expect(readBack).toBe(content);
    });
  });
});
