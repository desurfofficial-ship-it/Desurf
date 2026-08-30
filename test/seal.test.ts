import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealSuite } from "../src/seal.js";
import { runSuite } from "../src/runner.js";
import { SavedOutputAdapter } from "../src/provider.js";
import { metaPathFor, sha256 } from "../src/fingerprint.js";
import { initSuite } from "../src/init.js";
import { recordSuite } from "../src/record.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

class MockProvider implements ModelAdapter {
  constructor(private response: string) {}
  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    return { text: this.response };
  }
}

describe("desurf seal (offline cassette provenance)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-seal-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function createManualSuite(target: string, customOutput?: string): Promise<string> {
    await mkdir(join(target, "inputs"), { recursive: true });
    await mkdir(join(target, "prompts"), { recursive: true });
    await mkdir(join(target, "outputs"), { recursive: true });

    const inputContent = "My account has a billing issue.\n";
    const promptContent = "Classify into JSON with category and explanation.\n";
    const outputContent =
      customOutput ??
      JSON.stringify(
        {
          category: "billing",
          explanation: "Customer mentions a billing issue.",
        },
        null,
        2
      ) + "\n";

    await writeFile(join(target, "inputs", "req.txt"), inputContent, "utf8");
    await writeFile(join(target, "prompts", "prompt.txt"), promptContent, "utf8");
    await writeFile(join(target, "outputs", "resp.json"), outputContent, "utf8");

    const suite = {
      name: "manual-suite",
      cases: [
        {
          id: "billing-case",
          input: "inputs/req.txt",
          prompt: "prompts/prompt.txt",
          output: "outputs/resp.json",
          assertions: [
            { type: "required", value: "billing" },
            {
              type: "json_schema",
              schema: { type: "object", required: ["category", "explanation"] },
            },
          ],
        },
      ],
    };
    await writeFile(join(target, "suite.json"), JSON.stringify(suite, null, 2) + "\n", "utf8");
    return target;
  }

  it("seals unsealed suite and test passes", async () => {
    const suiteDir = join(dir, "suite-seal");
    await createManualSuite(suiteDir);
    const res = await sealSuite({ suitePath: suiteDir });
    expect(res.results[0].status).toBe("sealed");
    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("stale prompt after seal returns ERROR with seal --force guidance", async () => {
    const suiteDir = join(dir, "suite-stale");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    await writeFile(join(suiteDir, "prompts", "prompt.txt"), "CHANGED\n", "utf8");
    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.errors).toBe(1);
    expect(summary.cases[0].executions[0].error).toMatch(/Prompt changed since output was recorded/i);
    expect(summary.cases[0].executions[0].error).toMatch(/desurf seal --force/i);
  });

  it("Error when output file is missing", async () => {
    const suiteDir = join(dir, "suite-missing-out");
    await createManualSuite(suiteDir);
    await rm(join(suiteDir, "outputs", "resp.json"));
    const res = await sealSuite({ suitePath: suiteDir });
    expect(res.results[0].status).toBe("error");
    expect(res.results[0].message).toMatch(/Missing or empty output file|Output file does not exist or is empty/i);
  });

  it("Error when output file is empty", async () => {
    const suiteDir = join(dir, "suite-empty-out");
    await createManualSuite(suiteDir);
    await writeFile(join(suiteDir, "outputs", "resp.json"), "", "utf8");
    const res = await sealSuite({ suitePath: suiteDir });
    expect(res.results[0].status).toBe("error");
    expect(res.results[0].message).toMatch(/Missing or empty output file|Output file does not exist or is empty/i);
  });

  it("without --force existing metadata is preserved", async () => {
    const suiteDir = join(dir, "suite-skip");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const metaPath = metaPathFor(join(suiteDir, "outputs", "resp.json"));
    const before = await readFile(metaPath, "utf8");
    const res = await sealSuite({ suitePath: suiteDir });
    expect(res.results[0].status).toBe("skipped");
    expect(await readFile(metaPath, "utf8")).toBe(before);
  });

  it("--force overwrites metadata", async () => {
    const suiteDir = join(dir, "suite-force");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const res = await sealSuite({ suitePath: suiteDir, force: true });
    expect(res.results[0].status).toBe("sealed");
  });

  it("--case only seals the requested case", async () => {
    const suiteDir = join(dir, "suite-multi-case");
    await mkdir(join(suiteDir, "inputs"), { recursive: true });
    await mkdir(join(suiteDir, "prompts"), { recursive: true });
    await mkdir(join(suiteDir, "outputs"), { recursive: true });
    await writeFile(join(suiteDir, "inputs", "a.txt"), "input a\n", "utf8");
    await writeFile(join(suiteDir, "inputs", "b.txt"), "input b\n", "utf8");
    await writeFile(join(suiteDir, "prompts", "prompt.txt"), "prompt\n", "utf8");
    await writeFile(
      join(suiteDir, "outputs", "a.json"),
      JSON.stringify({ category: "billing", explanation: "a" }) + "\n",
      "utf8"
    );
    await writeFile(
      join(suiteDir, "outputs", "b.json"),
      JSON.stringify({ category: "billing", explanation: "b" }) + "\n",
      "utf8"
    );
    await writeFile(
      join(suiteDir, "suite.json"),
      JSON.stringify(
        {
          name: "multi",
          cases: [
            {
              id: "case-a",
              input: "inputs/a.txt",
              prompt: "prompts/prompt.txt",
              output: "outputs/a.json",
              assertions: [{ type: "required", value: "billing" }],
            },
            {
              id: "case-b",
              input: "inputs/b.txt",
              prompt: "prompts/prompt.txt",
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
    const res = await sealSuite({ suitePath: suiteDir, caseId: "case-a" });
    expect(res.results).toHaveLength(1);
    expect(res.results[0].caseId).toBe("case-a");
    expect(res.results[0].status).toBe("sealed");
    const metaA = metaPathFor(join(suiteDir, "outputs", "a.json"));
    const metaB = metaPathFor(join(suiteDir, "outputs", "b.json"));
    await expect(readFile(metaA, "utf8")).resolves.toMatch(/inputSha256/);
    await expect(readFile(metaB, "utf8")).rejects.toThrow();
  });

  it("Unknown --case id throws", async () => {
    const suiteDir = join(dir, "suite-unknown-case");
    await createManualSuite(suiteDir);
    await expect(
      sealSuite({ suitePath: suiteDir, caseId: "does-not-exist" })
    ).rejects.toThrow(/No test case with id/i);
  });
});
