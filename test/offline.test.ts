import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuite } from "../src/offline.js";
import { runSuite } from "../src/runner.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixtureRoot = resolve(__dirname, "../fixtures/basic");

describe("loadSuite", () => {
  it("loads the basic fixture suite", async () => {
    const suite = await loadSuite(fixtureRoot);
    expect(suite.name).toBe("basic");
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0].id).toBe("support-classifier-good");
    expect(suite.cases[0].assertions.length).toBeGreaterThan(0);
  });

  it("accepts a direct path to suite.json", async () => {
    const suite = await loadSuite(resolve(fixtureRoot, "suite.json"));
    expect(suite.name).toBe("basic");
  });

  it("rejects absolute paths in case definitions", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmp = await mkdtemp(join(tmpdir(), "desurf-jail-test-"));
    try {
      const suiteJson = {
        name: "malicious-suite",
        cases: [
          {
            id: "bad-case",
            input: "in.txt",
            prompt: "prompt.txt",
            output: "/etc/passwd",
            assertions: [{ type: "required", value: "root" }],
          },
        ],
      };
      await writeFile(join(tmp, "suite.json"), JSON.stringify(suiteJson));
      await expect(loadSuite(tmp)).rejects.toThrow(/must be a path relative to the suite directory, got absolute path/i);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects directory traversal escaping the suite root", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmp = await mkdtemp(join(tmpdir(), "desurf-jail-test-"));
    try {
      const suiteJson = {
        name: "malicious-suite",
        cases: [
          {
            id: "bad-case",
            input: "in.txt",
            prompt: "prompt.txt",
            output: "../../../../etc/passwd",
            assertions: [{ type: "required", value: "root" }],
          },
        ],
      };
      await writeFile(join(tmp, "suite.json"), JSON.stringify(suiteJson));
      await expect(loadSuite(tmp)).rejects.toThrow(/escapes the suite directory/i);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("runSuite (offline)", () => {
  it("runs the basic fixture and PASSes", async () => {
    const summary = await runSuite({ suitePath: fixtureRoot });
    expect(summary.suiteName).toBe("basic");
    expect(summary.passed).toBe(1);
    expect(summary.flaky).toBe(0);
    expect(summary.regression).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.cases[0].state).toBe("PASS");
  });

  it("can select a single case by id", async () => {
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
    });
    expect(summary.cases).toHaveLength(1);
    expect(summary.passed).toBe(1);
  });

  it("throws when case id is unknown", async () => {
    await expect(
      runSuite({ suitePath: fixtureRoot, caseId: "does-not-exist" })
    ).rejects.toThrow(/No test case/);
  });
});
