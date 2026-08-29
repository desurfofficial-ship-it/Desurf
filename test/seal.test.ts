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
              schema: {
                type: "object",
                required: ["category", "explanation"],
                properties: {
                  category: { const: "billing" },
                },
              },
            },
          ],
        },
      ],
    };

    await writeFile(join(target, "suite.json"), JSON.stringify(suite, null, 2) + "\n", "utf8");
    return target;
  }

  it("A & B & C: Existing response can be sealed offline without API keys, creating .desurf with correct SHA-256", async () => {
    const suiteDir = join(dir, "suite-abc");
    await createManualSuite(suiteDir);

    const outPath = join(suiteDir, "outputs", "resp.json");
    const metaFile = metaPathFor(outPath);

    // Verify no meta exists initially
    await expect(readFile(metaFile, "utf8")).rejects.toThrow();

    // Seal offline
    const sealResult = await sealSuite({ suitePath: suiteDir });
    expect(sealResult.results).toHaveLength(1);
    expect(sealResult.results[0].status).toBe("sealed");

    // Check meta content
    const metaRaw = await readFile(metaFile, "utf8");
    const meta = JSON.parse(metaRaw);
    expect(meta.version).toBe(1);

    const inputContent = await readFile(join(suiteDir, "inputs", "req.txt"), "utf8");
    const promptContent = await readFile(join(suiteDir, "prompts", "prompt.txt"), "utf8");

    expect(meta.inputSha256).toBe(sha256(inputContent));
    expect(meta.promptSha256).toBe(sha256(promptContent));
  });

  it("D: Fresh sealed suite → PASS (exit 0)", async () => {
    const suiteDir = join(dir, "suite-d");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });

    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.regression).toBe(0);
    expect(summary.flaky).toBe(0);
  });

  it("E: Change prompt on sealed suite → ERROR (exit 2)", async () => {
    const suiteDir = join(dir, "suite-e");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });

    // Change prompt
    await writeFile(join(suiteDir, "prompts", "prompt.txt"), "Modified prompt instructions.\n", "utf8");

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });

    expect(summary.errors).toBe(1);
    expect(summary.passed).toBe(0);
    expect(summary.cases[0].executions[0].error).toMatch(/Prompt changed since output was recorded/i);
  });

  it("F: Change input on sealed suite → ERROR (exit 2)", async () => {
    const suiteDir = join(dir, "suite-f");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });

    // Change input
    await writeFile(join(suiteDir, "inputs", "req.txt"), "Completely different user input.\n", "utf8");

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });

    expect(summary.errors).toBe(1);
    expect(summary.passed).toBe(0);
    expect(summary.cases[0].executions[0].error).toMatch(/Input changed since output was recorded/i);
  });

  it("G: Mutate cassette while input/prompt unchanged → REGRESSION (exit 1)", async () => {
    const suiteDir = join(dir, "suite-g");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });

    // Mutate cassette (regressed behavior: category becomes "other")
    await writeFile(
      join(suiteDir, "outputs", "resp.json"),
      JSON.stringify({ category: "other", explanation: "Unclassified." }, null, 2) + "\n",
      "utf8"
    );

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });

    expect(summary.regression).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.cases[0].executions[0].assertionResults.some((a) => !a.passed)).toBe(true);
  });

  it("H: Restore everything after mutation → PASS (exit 0)", async () => {
    const suiteDir = join(dir, "suite-h");
    await createManualSuite(suiteDir);
    await sealSuite({ suitePath: suiteDir });

    const originalOutput = await readFile(join(suiteDir, "outputs", "resp.json"), "utf8");

    // Mutate cassette
    await writeFile(
      join(suiteDir, "outputs", "resp.json"),
      JSON.stringify({ category: "other", explanation: "Wrong." }, null, 2) + "\n",
      "utf8"
    );
    let summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.regression).toBe(1);

    // Restore original output
    await writeFile(join(suiteDir, "outputs", "resp.json"), originalOutput, "utf8");

    summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.regression).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("I: Legacy suites without .desurf still behave exactly as before", async () => {
    const suiteDir = join(dir, "suite-legacy");
    await createManualSuite(suiteDir);

    // Do NOT seal
    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });

    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);

    // Changing prompt on unsealed legacy suite doesn't trigger stale error (documented legacy behavior)
    await writeFile(join(suiteDir, "prompts", "prompt.txt"), "Brand new prompt.\n", "utf8");
    const summaryAfter = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summaryAfter.passed).toBe(1);
    expect(summaryAfter.errors).toBe(0);
  });

  it("J: Existing record behavior remains unchanged", async () => {
    const suiteDir = join(dir, "suite-rec");
    await initSuite(suiteDir);

    const mockProvider = new MockProvider(
      JSON.stringify({ category: "technical", reason: "Recorded via provider." }, null, 2) + "\n"
    );

    const recResult = await recordSuite({
      suitePath: suiteDir,
      provider: mockProvider,
      providerName: "openrouter",
      force: true,
    });

    expect(recResult.results[0].status).toBe("recorded");

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("K: Existing init behavior remains unchanged", async () => {
    const suiteDir = join(dir, "suite-init");
    await initSuite(suiteDir);

    const summary = await runSuite({
      suitePath: suiteDir,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("Conservative overwrite safety: skips without --force, updates with --force", async () => {
    const suiteDir = join(dir, "suite-safety");
    await createManualSuite(suiteDir);

    // First seal
    const res1 = await sealSuite({ suitePath: suiteDir });
    expect(res1.results[0].status).toBe("sealed");

    // Second seal without force -> skipped
    const res2 = await sealSuite({ suitePath: suiteDir, force: false });
    expect(res2.results[0].status).toBe("skipped");

    // Update prompt
    await writeFile(join(suiteDir, "prompts", "prompt.txt"), "New prompt v2.\n", "utf8");

    // Seal with force -> sealed with new prompt hash
    const res3 = await sealSuite({ suitePath: suiteDir, force: true });
    expect(res3.results[0].status).toBe("sealed");

    const meta = JSON.parse(await readFile(metaPathFor(join(suiteDir, "outputs", "resp.json")), "utf8"));
    expect(meta.promptSha256).toBe(sha256("New prompt v2.\n"));
  });

  it("Error when output file is missing", async () => {
    const suiteDir = join(dir, "suite-missing-out");
    await createManualSuite(suiteDir);
    await rm(join(suiteDir, "outputs", "resp.json"));

    const res = await sealSuite({ suitePath: suiteDir });
    expect(res.results[0].status).toBe("error");
    expect(res.results[0].message).toMatch(/Output file does not exist or is empty/i);
  });
});
