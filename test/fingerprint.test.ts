import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sha256,
  buildMeta,
  writeCassetteMeta,
  assertCassetteFresh,
  metaPathFor,
} from "../src/fingerprint.js";
import { initSuite } from "../src/init.js";
import { runSuite } from "../src/runner.js";
import { SavedOutputAdapter } from "../src/provider.js";
import { recordSuite } from "../src/record.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

class MockProvider implements ModelAdapter {
  constructor(private response: string) {}
  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    return { text: this.response };
  }
}

describe("fingerprint helpers", () => {
  it("sha256 is stable", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("buildMeta hashes input and prompt separately", () => {
    const m = buildMeta("in", "pr");
    expect(m.version).toBe(1);
    expect(m.inputSha256).toBe(sha256("in"));
    expect(m.promptSha256).toBe(sha256("pr"));
  });
});

describe("stale fixture detection", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-stale-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("A: init fixture → test → PASS", async () => {
    const target = join(dir, "suite-a");
    await initSuite(target);
    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
    expect(summary.regression).toBe(0);
  });

  it("B: change prompt → ERROR", async () => {
    const target = join(dir, "suite-b");
    await initSuite(target);
    await writeFile(
      join(target, "prompts", "classify.txt"),
      "CHANGED PROMPT\n",
      "utf8"
    );
    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.errors).toBe(1);
    expect(summary.passed).toBe(0);
    const err = summary.cases[0].executions[0].error ?? "";
    expect(err).toMatch(/Prompt changed since output was recorded/i);
    expect(err).toMatch(/desurf seal --force/i);
    expect(err).toMatch(/desurf record --force/i);
  });

  it("C: change input → ERROR", async () => {
    const target = join(dir, "suite-c");
    await initSuite(target);
    await writeFile(
      join(target, "inputs", "support-request.txt"),
      "CHANGED INPUT\n",
      "utf8"
    );
    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.errors).toBe(1);
    const err = summary.cases[0].executions[0].error ?? "";
    expect(err).toMatch(/Input changed since output was recorded/i);
  });

  it("D: restore prompt/input → PASS", async () => {
    const target = join(dir, "suite-d");
    await initSuite(target);
    const promptPath = join(target, "prompts", "classify.txt");
    const original = await readFile(promptPath, "utf8");
    await writeFile(promptPath, "CHANGED\n", "utf8");
    let summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.errors).toBe(1);
    await writeFile(promptPath, original, "utf8");
    summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("E: regression still returns REGRESSION when fingerprints match", async () => {
    const target = join(dir, "suite-e");
    await initSuite(target);
    await writeFile(
      join(target, "outputs", "classify.json"),
      JSON.stringify({
        category: "other",
        reason: "I am an AI language model.",
      }) + "\n",
      "utf8"
    );
    const input = await readFile(join(target, "inputs", "support-request.txt"), "utf8");
    const prompt = await readFile(join(target, "prompts", "classify.txt"), "utf8");
    await writeCassetteMeta(join(target, "outputs", "classify.json"), input, prompt);

    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.regression).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("F: legacy fixture without meta still PASSes", async () => {
    const target = join(dir, "legacy");
    await mkdir(join(target, "inputs"), { recursive: true });
    await mkdir(join(target, "prompts"), { recursive: true });
    await mkdir(join(target, "outputs"), { recursive: true });
    await writeFile(join(target, "inputs", "in.txt"), "hello\n", "utf8");
    await writeFile(join(target, "prompts", "p.txt"), "say hi\n", "utf8");
    await writeFile(join(target, "outputs", "out.txt"), "hello world\n", "utf8");
    await writeFile(
      join(target, "suite.json"),
      JSON.stringify({
        name: "legacy",
        cases: [
          {
            id: "legacy-case",
            input: "inputs/in.txt",
            prompt: "prompts/p.txt",
            output: "outputs/out.txt",
            assertions: [{ type: "required", value: "hello" }],
          },
        ],
      }),
      "utf8"
    );
    const summary = await runSuite({
      suitePath: target,
      provider: new SavedOutputAdapter(),
    });
    expect(summary.passed).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("record writes meta sidecar", async () => {
    const target = join(dir, "rec");
    await initSuite(target);
    const provider = new MockProvider('{"category":"technical","reason":"x"}');
    await recordSuite({
      suitePath: target,
      provider,
      providerName: "openrouter",
      force: true,
    });
    const meta = JSON.parse(
      await readFile(metaPathFor(join(target, "outputs", "classify.json")), "utf8")
    );
    expect(meta.inputSha256).toBeTruthy();
    expect(meta.promptSha256).toBeTruthy();
  });

  it("assertCassetteFresh no-ops without meta", async () => {
    const out = join(dir, "bare-out.txt");
    await writeFile(out, "x", "utf8");
    await expect(assertCassetteFresh(out, "a", "b")).resolves.toBeUndefined();
  });
});
