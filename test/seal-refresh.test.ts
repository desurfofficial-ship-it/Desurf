import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealSuite } from "../src/seal.js";
import { runSuite } from "../src/runner.js";
import { SavedOutputAdapter } from "../src/provider.js";
import { metaPathFor, sha256 } from "../src/fingerprint.js";

async function createManualSuite(target: string): Promise<void> {
  await mkdir(join(target, "inputs"), { recursive: true });
  await mkdir(join(target, "prompts"), { recursive: true });
  await mkdir(join(target, "outputs"), { recursive: true });
  await writeFile(join(target, "inputs", "req.txt"), "My account has a billing issue.\n", "utf8");
  await writeFile(
    join(target, "prompts", "prompt.txt"),
    "Classify into JSON with category and explanation.\n",
    "utf8"
  );
  await writeFile(
    join(target, "outputs", "resp.json"),
    JSON.stringify(
      { category: "billing", explanation: "Customer mentions a billing issue." },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await writeFile(
    join(target, "suite.json"),
    JSON.stringify(
      {
        name: "manual-suite",
        cases: [
          {
            id: "billing-case",
            input: "inputs/req.txt",
            prompt: "prompts/prompt.txt",
            output: "outputs/resp.json",
            assertions: [
              { type: "required", value: "billing" },
              { type: "json_schema", schema: { type: "object", required: ["category"] } },
            ],
          },
        ],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

describe("seal --force refresh workflow", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-refresh-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prompt drift → ERROR → seal --force → PASS; output unchanged", async () => {
    const suiteDir = join(dir, "refresh-prompt");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const outPath = join(suiteDir, "outputs", "resp.json");
    const outBefore = await readFile(outPath, "utf8");

    await writeFile(join(suiteDir, "prompts", "prompt.txt"), "CHANGED PROMPT\n", "utf8");
    let summary = await runSuite({ suitePath: suiteDir, provider: new SavedOutputAdapter() });
    expect(summary.errors).toBe(1);
    expect(summary.cases[0].executions[0].error).toMatch(/Prompt changed/i);
    expect(summary.cases[0].executions[0].error).toMatch(/desurf seal --force/i);

    const sealRes = await sealSuite({ suitePath: suiteDir, force: true });
    expect(sealRes.results[0].status).toBe("sealed");
    expect(await readFile(outPath, "utf8")).toBe(outBefore);

    const meta = JSON.parse(await readFile(metaPathFor(outPath), "utf8"));
    const newPrompt = await readFile(join(suiteDir, "prompts", "prompt.txt"), "utf8");
    expect(meta.promptSha256).toBe(sha256(newPrompt));
    expect(meta.source).toBe("seal");

    summary = await runSuite({ suitePath: suiteDir, provider: new SavedOutputAdapter() });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("input drift → seal --force → PASS; output unchanged", async () => {
    const suiteDir = join(dir, "refresh-input");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });
    const outPath = join(suiteDir, "outputs", "resp.json");
    const outBefore = await readFile(outPath, "utf8");

    await writeFile(join(suiteDir, "inputs", "req.txt"), "CHANGED INPUT\n", "utf8");
    let summary = await runSuite({ suitePath: suiteDir, provider: new SavedOutputAdapter() });
    expect(summary.errors).toBe(1);
    expect(summary.cases[0].executions[0].error).toMatch(/Input changed/i);

    await sealSuite({ suitePath: suiteDir, force: true });
    expect(await readFile(outPath, "utf8")).toBe(outBefore);

    const meta = JSON.parse(await readFile(metaPathFor(outPath), "utf8"));
    const newInput = await readFile(join(suiteDir, "inputs", "req.txt"), "utf8");
    expect(meta.inputSha256).toBe(sha256(newInput));

    summary = await runSuite({ suitePath: suiteDir, provider: new SavedOutputAdapter() });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });
});
