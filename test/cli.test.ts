import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "src", "cli.ts");

function runCli(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", CLI, ...args], {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("CLI", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-cli-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("--version prints 0.1.1 and exits 0", async () => {
    const r = await runCli(["--version"]);
    expect(r.stdout.trim()).toBe("0.1.1");
    expect(r.code).toBe(0);
  });

  it("-v prints 0.1.1 and exits 0", async () => {
    const r = await runCli(["-v"]);
    expect(r.stdout.trim()).toBe("0.1.1");
    expect(r.code).toBe(0);
  });

  it("--help exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage:/i);
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
});
