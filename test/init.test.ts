import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSuite } from "../src/init.js";
import { loadSuite } from "../src/offline.js";
import { runSuite } from "../src/runner.js";
import { SavedOutputAdapter } from "../src/provider.js";

describe("desurf init", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-init-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates suite structure with structured-output example", async () => {
    const target = join(dir, "my-suite");
    await initSuite(target);
    await access(join(target, "suite.json"));
    await access(join(target, "inputs", "support-request.txt"));
    await access(join(target, "prompts", "classify.txt"));
    await access(join(target, "outputs", "classify.json"));

    const suite = JSON.parse(await readFile(join(target, "suite.json"), "utf8"));
    expect(suite.name).toBe("my-suite");
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0].id).toBe("example-case");
    expect(suite.cases[0].output).toBe("outputs/classify.json");
    const types = suite.cases[0].assertions.map((a: { type: string }) => a.type);
    expect(types).toContain("json_schema");
    expect(types).toContain("forbidden");
    expect(types).toContain("regex");
  });

  it("generated suite runs and PASSes", async () => {
    const target = join(dir, "run-suite");
    await initSuite(target);
    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.regression).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("violating the saved output produces REGRESSION", async () => {
    const target = join(dir, "regress-suite");
    await initSuite(target);

    // Break the contract: wrong category + forbidden phrase
    await writeFile(
      join(target, "outputs", "classify.json"),
      JSON.stringify(
        {
          category: "other",
          reason: "I am an AI language model and cannot classify this.",
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(0);
    expect(summary.regression).toBe(1);
  });

  it("refuses overwrite", async () => {
    const target = join(dir, "existing");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "suite.json"), '{"name":"x","cases":[]}', "utf8");
    await expect(initSuite(target)).rejects.toThrow(/Refusing/i);
  });

  it("loadSuite accepts generated suite", async () => {
    const target = join(dir, "load-suite");
    await initSuite(target);
    const suite = await loadSuite(target);
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0].id).toBe("example-case");
    expect(suite.cases[0].assertions.length).toBeGreaterThanOrEqual(2);
  });
});
