import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, access, mkdir, writeFile } from "node:fs/promises";
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

  it("creates suite structure", async () => {
    const target = join(dir, "my-suite");
    await initSuite(target);
    await access(join(target, "suite.json"));
    await access(join(target, "inputs", "example.txt"));
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
  });

  it("refuses overwrite", async () => {
    const target = join(dir, "existing");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "suite.json"), '{"name":"x","cases":[]}', "utf8");
    await expect(initSuite(target)).rejects.toThrow(/Refusing/i);
  });
});
