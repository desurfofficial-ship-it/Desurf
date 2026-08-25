import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSuite } from "../src/init.js";
import { recordSuite } from "../src/record.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

class MockProvider implements ModelAdapter {
  constructor(
    private response: string,
    private shouldFail?: string
  ) {}

  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    if (this.shouldFail) {
      throw new Error(this.shouldFail);
    }
    return { text: this.response };
  }
}

describe("desurf record", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-record-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("successful capture with force", async () => {
    const suite = join(dir, "suite");
    await initSuite(suite);
    const provider = new MockProvider("captured-live-output");
    const summary = await recordSuite({
      suitePath: suite,
      provider,
      providerName: "openrouter",
      force: true,
    });
    expect(summary.results[0].status).toBe("recorded");
    const text = await readFile(join(suite, "outputs", "example.txt"), "utf8");
    expect(text).toBe("captured-live-output");
  });

  it("existing non-empty output is skipped without force", async () => {
    const suite = join(dir, "suite-skip");
    await initSuite(suite);
    const provider = new MockProvider("should-not-write");
    const summary = await recordSuite({
      suitePath: suite,
      provider,
      providerName: "openrouter",
      force: false,
    });
    expect(summary.results[0].status).toBe("skipped");
    const text = await readFile(join(suite, "outputs", "example.txt"), "utf8");
    expect(text).not.toBe("should-not-write");
  });

  it("force overwrites existing output", async () => {
    const suite = join(dir, "suite-force");
    await initSuite(suite);
    const provider = new MockProvider("forced-new-content");
    const summary = await recordSuite({
      suitePath: suite,
      provider,
      providerName: "openrouter",
      force: true,
    });
    expect(summary.results[0].status).toBe("recorded");
    const text = await readFile(join(suite, "outputs", "example.txt"), "utf8");
    expect(text).toBe("forced-new-content");
  });

  it("provider failure is reported per case", async () => {
    const suite = join(dir, "suite-fail");
    await initSuite(suite);
    await writeFile(join(suite, "outputs", "example.txt"), "", "utf8");
    const provider = new MockProvider("x", "OpenRouterAdapter: missing API key");
    const summary = await recordSuite({
      suitePath: suite,
      provider,
      providerName: "openrouter",
      force: true,
    });
    expect(summary.results[0].status).toBe("error");
    expect(summary.results[0].message).toMatch(/missing API key/i);
  });

  it("offline provider is rejected", async () => {
    const suite = join(dir, "suite-offline");
    await initSuite(suite);
    const provider = new MockProvider("x");
    await expect(
      recordSuite({
        suitePath: suite,
        provider,
        providerName: "offline",
      })
    ).rejects.toThrow(/live provider/i);
  });

  it("unknown case throws", async () => {
    const suite = join(dir, "suite-unknown");
    await initSuite(suite);
    const provider = new MockProvider("x");
    await expect(
      recordSuite({
        suitePath: suite,
        provider,
        providerName: "openrouter",
        caseId: "does-not-exist",
      })
    ).rejects.toThrow(/No test case with id/i);
  });
});
