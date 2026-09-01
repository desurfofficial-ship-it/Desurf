import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

function runCli(args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
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

describe("CLI", { timeout: 25000 }, () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-cli-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("--version prints 0.8.0 and exits 0", async () => {
    const r = await runCli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("0.8.0");
  });

  it("-v prints 0.8.0 and exits 0", async () => {
    const r = await runCli(["-v"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("0.8.0");
  });

  it("--version after command exits 2 with clear error message", async () => {
    const r = await runCli(["test", "--suite", "fixtures/basic", "--version"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Unknown option: --version \(did you mean: desurf --version \?\)/);
  });

  it("-v after command exits 2 with clear error message", async () => {
    const r = await runCli(["test", "--suite", "fixtures/basic", "-v"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Unknown option: -v \(did you mean: desurf --version \?\)/);
  });

  it("--help exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage/i);
  });

  it("test --help exits 0", async () => {
    const r = await runCli(["test", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/--suite/i);
  });

  it("init --help exits 0", async () => {
    const r = await runCli(["init", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/directory/i);
  });

  it("record --help exits 0", async () => {
    const r = await runCli(["record", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/--provider/i);
  });

  it("seal --help exits 0", async () => {
    const r = await runCli(["seal", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/--suite/i);
    expect(r.stdout).toMatch(/provenance/i);
  });

  it("seal CLI seals unsealed suite and test passes", async () => {
    const target = join(dir, "cli-seal-suite");
    await runCli(["init", target]);
    // remove sidecar
    const metaFile = join(target, "outputs", "classify.json.desurf");
    await rm(metaFile, { force: true });

    const seal = await runCli(["seal", "--suite", target]);
    expect(seal.code).toBe(0);
    expect(seal.stdout).toMatch(/sealed/i);

    const test = await runCli(["test", "--suite", target]);
    expect(test.code).toBe(0);
    expect(test.stdout).toMatch(/PASS/);
  });

  it("init creates suite and test passes", async () => {
    const target = join(dir, "new-suite");
    const init = await runCli(["init", target]);
    expect(init.code).toBe(0);

    const test = await runCli(["test", "--suite", target]);
    expect(test.code).toBe(0);
    expect(test.stdout).toMatch(/PASS/);
  });

  it("test --json produces valid JSON for passing suite", async () => {
    const r = await runCli(["test", "--suite", "fixtures/basic", "--json"]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.status).toBe("PASS");
    expect(data.suite).toBe("basic");
    expect(Array.isArray(data.cases)).toBe(true);
  });

  it("test --json for regression suite", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "examples/support-agent",
      "--case",
      "support-classifier-regressed",
      "--json",
    ]);
    expect(r.code).toBe(1);
    const data = JSON.parse(r.stdout);
    expect(data.status).toBe("REGRESSION");
  });

  it("test --verbose includes output context", async () => {
    const r = await runCli(["test", "--suite", "fixtures/basic", "--verbose"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/output:/i);
  });

  it("record rejects offline provider", async () => {
    const target = join(dir, "rec");
    await runCli(["init", target]);
    const r = await runCli([
      "record",
      "--suite",
      target,
      "--provider",
      "offline",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/live provider/i);
  });

  it("record without --provider returns exit 2 with clear error", async () => {
    const target = join(dir, "rec-no-prov");
    await runCli(["init", target]);
    const r = await runCli(["record", "--suite", target]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Missing required option: --provider/i);
  });

  it("record with unknown provider returns exit 2", async () => {
    const target = join(dir, "rec-unk-prov");
    await runCli(["init", target]);
    const r = await runCli([
      "record",
      "--suite",
      target,
      "--provider",
      "unknown-ai-provider",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Unknown provider/i);
  });

  it("test rejects out of bounds temperature with exit 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--temperature",
      "3.5",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--temperature must be between 0 and 2/i);
  });

  it("test rejects non-integer max-tokens with exit 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--max-tokens",
      "abc",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--max-tokens must be a non-negative decimal integer/i);
  });

  it("test rejects max-retries > 5 with exit 2", async () => {
    const r = await runCli([
      "test",
      "--suite",
      "fixtures/basic",
      "--max-retries",
      "10",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--max-retries is capped at 5/i);
  });
});
