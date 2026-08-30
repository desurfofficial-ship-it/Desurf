import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sealSuite } from "../src/seal.js";
import { recordSuite } from "../src/record.js";
import { runSuite } from "../src/runner.js";
import { SavedOutputAdapter } from "../src/provider.js";
import { initSuite } from "../src/init.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

class MockProvider implements ModelAdapter {
  constructor(private response: string) {}
  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    return { text: this.response };
  }
}

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

describe("unsealed cassette visibility", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-vis-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeManualSuite(target: string): Promise<void> {
    await mkdir(join(target, "inputs"), { recursive: true });
    await mkdir(join(target, "prompts"), { recursive: true });
    await mkdir(join(target, "outputs"), { recursive: true });
    await writeFile(join(target, "inputs", "req.txt"), "billing problem\n", "utf8");
    await writeFile(
      join(target, "prompts", "p.txt"),
      "Return JSON with category billing.\n",
      "utf8"
    );
    await writeFile(
      join(target, "outputs", "resp.json"),
      JSON.stringify({ category: "billing", explanation: "billing" }, null, 2) + "\n",
      "utf8"
    );
    await writeFile(
      join(target, "suite.json"),
      JSON.stringify(
        {
          name: "vis",
          cases: [
            {
              id: "c1",
              input: "inputs/req.txt",
              prompt: "prompts/p.txt",
              output: "outputs/resp.json",
              assertions: [{ type: "required", value: "billing" }],
            },
          ],
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  it("unsealed passing case → exit 0 + visible UNSEALED indication", async () => {
    const suiteDir = join(dir, "unsealed");
    await makeManualSuite(suiteDir);

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.cases[0].cassetteState).toBe("unsealed");

    const cli = await runCli(["test", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/PASS/);
    expect(cli.stdout).toMatch(/UNSEALED/i);
    expect(cli.stdout).toMatch(/desurf seal/i);
  });

  it("sealed passing case → exit 0 + no unsealed warning", async () => {
    const suiteDir = join(dir, "sealed");
    await makeManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.cases[0].cassetteState).toBe("sealed");

    const cli = await runCli(["test", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/PASS/);
    expect(cli.stdout).not.toMatch(/UNSEALED/);
  });

  it("recorded passing case → exit 0 + no unsealed warning", async () => {
    const suiteDir = join(dir, "recorded");
    await initSuite(suiteDir);
    await recordSuite({
      suitePath: suiteDir,
      provider: new MockProvider(
        JSON.stringify({ category: "technical", reason: "ops" }, null, 2) + "\n"
      ),
      providerName: "openrouter",
      force: true,
    });

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.cases[0].cassetteState).toBe("recorded");

    const cli = await runCli(["test", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).not.toMatch(/UNSEALED/);
  });

  it("unsealed regression still → exit 1", async () => {
    const suiteDir = join(dir, "unsealed-reg");
    await makeManualSuite(suiteDir);
    await writeFile(
      join(suiteDir, "outputs", "resp.json"),
      JSON.stringify({ category: "other", explanation: "nope" }, null, 2) + "\n",
      "utf8"
    );

    const cli = await runCli(["test", "--suite", suiteDir]);
    expect(cli.code).toBe(1);
    expect(cli.stdout).toMatch(/REGRESSION/);
    expect(cli.stdout).toMatch(/UNSEALED/i);
  });

  it("sealed stale prompt still → exit 2", async () => {
    const suiteDir = join(dir, "stale");
    await makeManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    await writeFile(join(suiteDir, "prompts", "p.txt"), "CHANGED\n", "utf8");

    const cli = await runCli(["test", "--suite", suiteDir]);
    expect(cli.code).toBe(2);
    expect(cli.stdout).toMatch(/ERROR|Prompt changed/i);
  });

  it("--json remains valid JSON and includes cassetteState", async () => {
    const suiteDir = join(dir, "json-unsealed");
    await makeManualSuite(suiteDir);

    const cli = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(cli.code).toBe(0);
    const parsed = JSON.parse(cli.stdout);
    expect(parsed.cases[0].cassetteState).toBe("unsealed");
    expect(cli.stdout.trim().startsWith("{")).toBe(true);
  });

  it("mixed suite reports states independently", async () => {
    const suiteDir = join(dir, "mixed");
    await mkdir(join(suiteDir, "inputs"), { recursive: true });
    await mkdir(join(suiteDir, "prompts"), { recursive: true });
    await mkdir(join(suiteDir, "outputs"), { recursive: true });
    await writeFile(join(suiteDir, "inputs", "a.txt"), "a\n", "utf8");
    await writeFile(join(suiteDir, "inputs", "b.txt"), "b\n", "utf8");
    await writeFile(join(suiteDir, "prompts", "p.txt"), "p\n", "utf8");
    await writeFile(
      join(suiteDir, "outputs", "a.json"),
      JSON.stringify({ category: "billing" }) + "\n",
      "utf8"
    );
    await writeFile(
      join(suiteDir, "outputs", "b.json"),
      JSON.stringify({ category: "billing" }) + "\n",
      "utf8"
    );
    await writeFile(
      join(suiteDir, "suite.json"),
      JSON.stringify(
        {
          name: "mixed",
          cases: [
            {
              id: "unsealed-case",
              input: "inputs/a.txt",
              prompt: "prompts/p.txt",
              output: "outputs/a.json",
              assertions: [{ type: "required", value: "billing" }],
            },
            {
              id: "sealed-case",
              input: "inputs/b.txt",
              prompt: "prompts/p.txt",
              output: "outputs/b.json",
              assertions: [{ type: "required", value: "billing" }],
            },
          ],
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    await sealSuite({ suitePath: suiteDir, caseId: "sealed-case" });

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    const byId = Object.fromEntries(summary.cases.map((c) => [c.caseId, c]));
    expect(byId["unsealed-case"].cassetteState).toBe("unsealed");
    expect(byId["sealed-case"].cassetteState).toBe("sealed");

    const cli = await runCli(["test", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/unsealed-case[\s\S]*UNSEALED/i);
  });
});
