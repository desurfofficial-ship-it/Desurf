import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { sealSuite } from "../src/seal.js";
import { recordSuite } from "../src/record.js";
import { inspectSuite } from "../src/inspect.js";
import { writeCassetteMeta, metaPathFor } from "../src/fingerprint.js";
import { initSuite } from "../src/init.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

class MockProvider implements ModelAdapter {
  constructor(private response: string) {}
  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    return { text: this.response };
  }
}

function runCli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: process.cwd(),
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

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

describe("desurf inspect", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-inspect-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function makeSuite(target: string): Promise<void> {
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
      JSON.stringify({ category: "billing" }, null, 2) + "\n",
      "utf8"
    );
    await writeFile(
      join(target, "suite.json"),
      JSON.stringify(
        {
          name: "inspect-suite",
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

  it("unsealed suite → inspect reports UNSEALED", async () => {
    const suiteDir = join(dir, "unsealed");
    await makeSuite(suiteDir);
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].cassetteState).toBe("unsealed");
    expect(summary.cases[0].metaPresent).toBe(false);
    expect(summary.cases[0].provenanceStatus).toBe("unsealed");
    const cli = await runCli(["inspect", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/UNSEALED/i);
  });

  it("newly sealed cassette → reports SEALED", async () => {
    const suiteDir = join(dir, "sealed");
    await makeSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].cassetteState).toBe("sealed");
    expect(summary.cases[0].provenanceStatus).toBe("fresh");
    const metaRaw = JSON.parse(
      await readFile(metaPathFor(summary.cases[0].outputPath), "utf8")
    );
    expect(metaRaw.source).toBe("seal");
    const cli = await runCli(["inspect", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/SEALED/);
  });

  it("newly recorded cassette → reports RECORDED", async () => {
    const suiteDir = join(dir, "recorded");
    await initSuite(suiteDir);
    await recordSuite({
      suitePath: suiteDir,
      provider: new MockProvider(
        JSON.stringify({ category: "technical", reason: "ops" }) + "\n"
      ),
      providerName: "openrouter",
      force: true,
    });
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].cassetteState).toBe("recorded");
    const metaRaw = JSON.parse(
      await readFile(metaPathFor(summary.cases[0].outputPath), "utf8")
    );
    expect(metaRaw.source).toBe("record");
    const cli = await runCli(["inspect", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/RECORDED/);
  });

  it("legacy v0.3.0 sidecar without source remains readable as sealed", async () => {
    const suiteDir = join(dir, "legacy");
    await makeSuite(suiteDir);
    const input = await readFile(join(suiteDir, "inputs", "req.txt"), "utf8");
    const prompt = await readFile(join(suiteDir, "prompts", "p.txt"), "utf8");
    await writeCassetteMeta(join(suiteDir, "outputs", "resp.json"), input, prompt);
    const metaRaw = JSON.parse(
      await readFile(join(suiteDir, "outputs", "resp.json.desurf"), "utf8")
    );
    expect(metaRaw.source).toBeUndefined();
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].cassetteState).toBe("sealed");
    expect(summary.cases[0].provenanceStatus).toBe("fresh");
  });

  it("prompt drift reported as stale", async () => {
    const suiteDir = join(dir, "stale-prompt");
    await makeSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    await writeFile(join(suiteDir, "prompts", "p.txt"), "CHANGED\n", "utf8");
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].provenanceStatus).toBe("stale");
    expect(summary.cases[0].promptFresh).toBe(false);
    const cli = await runCli(["inspect", "--suite", suiteDir]);
    expect(cli.code).toBe(0);
  });

  it("input drift reported as stale", async () => {
    const suiteDir = join(dir, "stale-input");
    await makeSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    await writeFile(join(suiteDir, "inputs", "req.txt"), "CHANGED\n", "utf8");
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].provenanceStatus).toBe("stale");
    expect(summary.cases[0].inputFresh).toBe(false);
  });

  it("inspection does not modify metadata or output", async () => {
    const suiteDir = join(dir, "readonly");
    await makeSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const out = join(suiteDir, "outputs", "resp.json");
    const meta = metaPathFor(out);
    const outHashBefore = await sha256File(out);
    const metaHashBefore = await sha256File(meta);
    await inspectSuite({ suitePath: suiteDir });
    await runCli(["inspect", "--suite", suiteDir]);
    expect(await sha256File(out)).toBe(outHashBefore);
    expect(await sha256File(meta)).toBe(metaHashBefore);
  });

  it("direct suite.json path works", async () => {
    const suiteDir = join(dir, "json-path");
    await makeSuite(suiteDir);
    const summary = await inspectSuite({ suitePath: join(suiteDir, "suite.json") });
    expect(summary.cases).toHaveLength(1);
    expect(summary.cases[0].cassetteState).toBe("unsealed");
  });

  it("multi-case suites report independently", async () => {
    const suiteDir = join(dir, "multi");
    await mkdir(join(suiteDir, "inputs"), { recursive: true });
    await mkdir(join(suiteDir, "prompts"), { recursive: true });
    await mkdir(join(suiteDir, "outputs"), { recursive: true });
    await writeFile(join(suiteDir, "inputs", "a.txt"), "a\n", "utf8");
    await writeFile(join(suiteDir, "inputs", "b.txt"), "b\n", "utf8");
    await writeFile(join(suiteDir, "prompts", "p.txt"), "p\n", "utf8");
    await writeFile(join(suiteDir, "outputs", "a.json"), '{"x":1}\n', "utf8");
    await writeFile(join(suiteDir, "outputs", "b.json"), '{"x":1}\n', "utf8");
    await writeFile(
      join(suiteDir, "suite.json"),
      JSON.stringify({
        name: "multi",
        cases: [
          { id: "a", input: "inputs/a.txt", prompt: "prompts/p.txt", output: "outputs/a.json", assertions: [{ type: "required", value: "x" }] },
          { id: "b", input: "inputs/b.txt", prompt: "prompts/p.txt", output: "outputs/b.json", assertions: [{ type: "required", value: "x" }] },
        ],
      }) + "\n",
      "utf8"
    );
    await sealSuite({ suitePath: suiteDir, caseId: "b" });
    const summary = await inspectSuite({ suitePath: suiteDir });
    const byId = Object.fromEntries(summary.cases.map((c) => [c.caseId, c]));
    expect(byId["a"].cassetteState).toBe("unsealed");
    expect(byId["b"].cassetteState).toBe("sealed");
  });

  it("--json output is valid JSON", async () => {
    const suiteDir = join(dir, "json-out");
    await makeSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const cli = await runCli(["inspect", "--suite", suiteDir, "--json"]);
    expect(cli.code).toBe(0);
    const parsed = JSON.parse(cli.stdout);
    expect(parsed.cases[0].cassetteState).toBe("sealed");
    expect(parsed.cases[0].provenanceStatus).toBe("fresh");
  });

  it("malformed provenance metadata returns exit 2 as INVALID not UNSEALED", async () => {
    const suiteDir = join(dir, "bad-meta");
    await makeSuite(suiteDir);
    await writeFile(join(suiteDir, "outputs", "resp.json.desurf"), "{not-json", "utf8");
    const summary = await inspectSuite({ suitePath: suiteDir });
    expect(summary.cases[0].cassetteState).toBe("invalid");
    expect(summary.cases[0].provenanceStatus).toBe("invalid");
    const cli = await runCli(["inspect", "--suite", suiteDir]);
    expect(cli.code).toBe(2);
    expect(cli.stdout).toMatch(/INVALID/i);
    expect(cli.stdout).not.toMatch(/cassette: UNSEALED/);
    const jsonCli = await runCli(["inspect", "--suite", suiteDir, "--json"]);
    expect(jsonCli.code).toBe(2);
    const parsed = JSON.parse(jsonCli.stdout);
    expect(parsed.cases[0].cassetteState).toBe("invalid");
  });

  it("inspect --help exits 0 and mentions offline", async () => {
    const cli = await runCli(["inspect", "--help"]);
    expect(cli.code).toBe(0);
    expect(cli.stdout).toMatch(/offline/i);
  });

  it("no provider/API key required", async () => {
    const suiteDir = join(dir, "no-key");
    await makeSuite(suiteDir);
    const env = { ...process.env };
    delete env.OPENROUTER_API_KEY;
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = spawn("npx", ["tsx", "src/cli.ts", "inspect", "--suite", suiteDir], {
        cwd: process.cwd(),
        env,
        shell: false,
      });
      let stdout = "";
      child.stdout.on("data", (d) => { stdout += String(d); });
      child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/UNSEALED/i);
  });
});
