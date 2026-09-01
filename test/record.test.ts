import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSuite } from "../src/init.js";
import { recordSuite, recordExitCode } from "../src/record.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

class MockProvider implements ModelAdapter {
  constructor(private response: string, private shouldFail?: string) {}
  async execute(_r: ExecuteRequest): Promise<ModelOutput> {
    if (this.shouldFail) throw new Error(this.shouldFail);
    return { text: this.response };
  }
}

describe("desurf record", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "desurf-rec-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("force writes + provenance", async () => {
    const suite = join(dir, "s");
    await initSuite(suite);
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider("captured"), providerName: "openai",
      model: "gpt-4o-mini", force: true,
    });
    expect(summary.results[0].status).toBe("recorded");
    expect(await readFile(join(suite, "outputs", "classify.json"), "utf8")).toBe("captured");
    const meta = JSON.parse(await readFile(join(suite, "outputs", "classify.json.desurf"), "utf8"));
    expect(meta.source).toBe("record");
  });

  it("propose unchanged (T2/T3)", async () => {
    const suite = join(dir, "u");
    await initSuite(suite);
    const baseline = await readFile(join(suite, "outputs", "classify.json"), "utf8");
    const metaB = await readFile(join(suite, "outputs", "classify.json.desurf"), "utf8");
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider(baseline), providerName: "openrouter",
    });
    expect(summary.results[0].verdict).toBe("unchanged");
    expect(summary.results[0].snapshot).toBeNull();
    expect(await readFile(join(suite, "outputs", "classify.json"), "utf8")).toBe(baseline);
    expect(await readFile(join(suite, "outputs", "classify.json.desurf"), "utf8")).toBe(metaB);
    expect(recordExitCode(summary, {})).toBe(0);
  });

  it("propose drift (T4)", async () => {
    const suite = join(dir, "d");
    await initSuite(suite);
    const baseline = await readFile(join(suite, "outputs", "classify.json"), "utf8");
    const metaB = await readFile(join(suite, "outputs", "classify.json.desurf"), "utf8");
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider('{"x":1}'), providerName: "openrouter",
    });
    expect(summary.results[0].verdict).toBe("drift");
    expect(summary.results[0].snapshot).toMatch(/\.desurf-history/);
    expect(await readFile(join(suite, "outputs", "classify.json"), "utf8")).toBe(baseline);
    expect(await readFile(join(suite, "outputs", "classify.json.desurf"), "utf8")).toBe(metaB);
    expect(recordExitCode(summary, {})).toBe(1);
  });

  it("force backup (T7)", async () => {
    const suite = join(dir, "f");
    await initSuite(suite);
    const old = await readFile(join(suite, "outputs", "classify.json"), "utf8");
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider("forced"), providerName: "openrouter", force: true,
    });
    expect(summary.results[0].message).toMatch(/--force accepted immediately/);
    const backup = JSON.parse(await readFile(join(suite, summary.results[0].snapshot!), "utf8"));
    expect(backup.kind).toBe("baseline-backup");
    expect(backup.output).toBe(old);
    expect(recordExitCode(summary, { force: true })).toBe(0);
  });

  it("provider error (T5)", async () => {
    const suite = join(dir, "e");
    await initSuite(suite);
    await writeFile(join(suite, "outputs", "classify.json"), "", "utf8");
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider("x", "missing API key"), providerName: "openrouter", force: true,
    });
    expect(summary.results[0].verdict).toBe("error");
    expect(recordExitCode(summary, { force: true })).toBe(2);
  });

  it("empty output (T9)", async () => {
    const suite = join(dir, "empty");
    await initSuite(suite);
    await writeFile(join(suite, "outputs", "classify.json"), "", "utf8");
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider(""), providerName: "openrouter",
    });
    expect(summary.results[0].verdict).toBe("error");
  });

  it("offline rejected", async () => {
    const suite = join(dir, "off");
    await initSuite(suite);
    await expect(recordSuite({
      suitePath: suite, provider: new MockProvider("x"), providerName: "offline",
    })).rejects.toThrow(/live provider/i);
  });

  it("unknown case", async () => {
    const suite = join(dir, "unk");
    await initSuite(suite);
    await expect(recordSuite({
      suitePath: suite, provider: new MockProvider("x"), providerName: "openrouter", caseId: "nope",
    })).rejects.toThrow(/No test case with id/i);
  });

  it("fill-gaps (T8)", async () => {
    const suite = join(dir, "g");
    await initSuite(suite);
    const baseline = await readFile(join(suite, "outputs", "classify.json"), "utf8");
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider("no"), providerName: "openrouter", fillGaps: true,
    });
    expect(summary.results[0].verdict).toBe("unchanged");
    expect(await readFile(join(suite, "outputs", "classify.json"), "utf8")).toBe(baseline);
  });

  it("first capture new (T1)", async () => {
    const suite = join(dir, "n");
    await initSuite(suite);
    await writeFile(join(suite, "outputs", "classify.json"), "", "utf8");
    try { await rm(join(suite, "outputs", "classify.json.desurf"), { force: true }); } catch {}
    const summary = await recordSuite({
      suitePath: suite, provider: new MockProvider('{"ok":true}'), providerName: "openai",
    });
    expect(summary.results[0].verdict).toBe("new");
    expect(await readFile(join(suite, "outputs", "classify.json"), "utf8")).toBe('{"ok":true}');
    expect(recordExitCode(summary, {})).toBe(0);
  });
});
