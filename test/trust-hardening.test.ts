/**
 * v0.1.2 trust-hardening regression tests.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluateAssertion } from "../src/assertions.js";
import { parseAssertion, loadSuite } from "../src/offline.js";
import type { ModelOutput } from "../src/types.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "src/cli.ts");

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("npx", ["tsx", cli, ...args], {
      cwd: root,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function writeSuite(dir: string, suite: unknown): Promise<void> {
  await mkdir(join(dir, "inputs"), { recursive: true });
  await mkdir(join(dir, "prompts"), { recursive: true });
  await mkdir(join(dir, "outputs"), { recursive: true });
  await writeFile(join(dir, "inputs", "in.txt"), "input", "utf8");
  await writeFile(join(dir, "prompts", "p.txt"), "prompt", "utf8");
  await writeFile(join(dir, "outputs", "out.txt"), "hello world", "utf8");
  await writeFile(join(dir, "suite.json"), JSON.stringify(suite, null, 2), "utf8");
}

describe("forbidden default case-insensitive", () => {
  const mixed: ModelOutput = { text: "As an AI, I can help..." };

  it("as an AI vs As an AI (default)", () => {
    expect(evaluateAssertion({ type: "forbidden", value: "as an AI" }, mixed).passed).toBe(false);
  });

  it("my instructions are vs My instructions are (default)", () => {
    const out = { text: "My instructions are secret." };
    expect(evaluateAssertion({ type: "forbidden", value: "my instructions are" }, out).passed).toBe(false);
  });

  it("mixed casing", () => {
    const out = { text: "AS AN ai LANGUAGE model" };
    expect(evaluateAssertion({ type: "forbidden", value: "As An AI" }, out).passed).toBe(false);
  });

  it("explicit caseSensitive true allows different case", () => {
    expect(evaluateAssertion({ type: "forbidden", value: "as an ai", caseSensitive: true }, mixed).passed).toBe(true);
  });

  it("explicit caseSensitive false detects different case", () => {
    expect(evaluateAssertion({ type: "forbidden", value: "as an ai", caseSensitive: false }, mixed).passed).toBe(false);
  });
});

describe("json_schema dialect enforcement", () => {
  it("valid supported schema parses", () => {
    const a = parseAssertion({
      type: "json_schema",
      schema: { type: "object", required: ["category"], properties: { category: { const: "billing" } } },
    });
    expect(a.type).toBe("json_schema");
  });

  it("supported schema violation fails assertion", () => {
    const out: ModelOutput = { text: JSON.stringify({ category: "other" }) };
    const r = evaluateAssertion({
      type: "json_schema",
      schema: { type: "object", properties: { category: { const: "billing" } } },
    }, out);
    expect(r.passed).toBe(false);
  });

  for (const kw of ["minLength", "minimum", "maximum", "pattern", "additionalProperties"]) {
    it(`unsupported keyword ${kw} throws`, () => {
      expect(() =>
        parseAssertion({ type: "json_schema", schema: { type: "object", [kw]: 1 } } as never)
      ).toThrow(new RegExp(`Unsupported json_schema keyword.*"${kw}"`));
    });
  }

  it("unsupported type string throws", () => {
    expect(() => parseAssertion({ type: "json_schema", schema: { type: "string" } } as never)).toThrow(/Unsupported json_schema type.*"string"/);
  });

  it("unsupported type array throws", () => {
    expect(() => parseAssertion({ type: "json_schema", schema: { type: "array" } } as never)).toThrow(/Unsupported json_schema type.*"array"/);
  });

  it("nested properties in property schema throws", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: { type: "object", properties: { nested: { properties: { x: { const: 1 } } } } },
      } as never)
    ).toThrow(/Unsupported json_schema keyword in properties.nested.*"properties"/);
  });
});

describe("suite validation", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "desurf-trust-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("empty suite throws", async () => {
    await writeSuite(dir, { name: "empty", cases: [] });
    await expect(loadSuite(dir)).rejects.toThrow(/no test cases/i);
  });

  it("empty assertions throws", async () => {
    await writeSuite(dir, {
      name: "no-assert",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [] }],
    });
    await expect(loadSuite(dir)).rejects.toThrow(/empty assertions/i);
  });

  it("duplicate case IDs throws", async () => {
    await writeSuite(dir, {
      name: "dup",
      cases: [
        { id: "same-id", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "required", value: "hello" }] },
        { id: "same-id", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "required", value: "hello" }] },
      ],
    });
    await expect(loadSuite(dir)).rejects.toThrow(/Duplicate case id.*"same-id"/);
  });

  it("invalid regex at load throws", async () => {
    await writeSuite(dir, {
      name: "bad-re",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "regex", pattern: "[unclosed" }] }],
    });
    await expect(loadSuite(dir)).rejects.toThrow(/Invalid regex/i);
  });
});

describe("CLI exit codes", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "desurf-cli-trust-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("empty suite -> exit 2", async () => {
    await writeSuite(dir, { name: "empty", cases: [] });
    const r = await runCli(["test", "--suite", dir]);
    expect(r.code).toBe(2);
  });

  it("empty assertions -> exit 2", async () => {
    await writeSuite(dir, {
      name: "no-a",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [] }],
    });
    expect((await runCli(["test", "--suite", dir])).code).toBe(2);
  });

  it("duplicate IDs -> exit 2", async () => {
    await writeSuite(dir, {
      name: "dup",
      cases: [
        { id: "x", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "required", value: "hello" }] },
        { id: "x", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "required", value: "hello" }] },
      ],
    });
    expect((await runCli(["test", "--suite", dir])).code).toBe(2);
  });

  it("invalid regex -> exit 2", async () => {
    await writeSuite(dir, {
      name: "bad-re",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "regex", pattern: "[unclosed" }] }],
    });
    expect((await runCli(["test", "--suite", dir])).code).toBe(2);
  });

  it("unsupported json_schema keyword -> exit 2", async () => {
    await writeSuite(dir, {
      name: "bad-schema",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "json_schema", schema: { type: "object", minLength: 5 } }] }],
    });
    const r = await runCli(["test", "--suite", dir]);
    expect(r.code).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/Unsupported json_schema keyword.*"minLength"/);
  });

  it("valid regex mismatch -> exit 1", async () => {
    await writeSuite(dir, {
      name: "re-miss",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "regex", pattern: "definitely-not-present-xyz" }] }],
    });
    await writeFile(join(dir, "outputs", "out.txt"), "no match here", "utf8");
    expect((await runCli(["test", "--suite", dir])).code).toBe(1);
  });

  it("valid regex match -> exit 0", async () => {
    await writeSuite(dir, {
      name: "re-hit",
      cases: [{ id: "c1", input: "inputs/in.txt", prompt: "prompts/p.txt", output: "outputs/out.txt", assertions: [{ type: "regex", pattern: "hello" }] }],
    });
    expect((await runCli(["test", "--suite", dir])).code).toBe(0);
  });

  it("PASS fixture -> exit 0", async () => {
    expect((await runCli(["test", "--suite", resolve(root, "fixtures/basic")])).code).toBe(0);
  });
});

describe("parseAssertion invalid regex", () => {
  it("unclosed bracket throws", () => {
    expect(() => parseAssertion({ type: "regex", pattern: "[unclosed" })).toThrow(/Invalid regex/i);
  });
  it("invalid flags throw", () => {
    expect(() => parseAssertion({ type: "regex", pattern: "abc", flags: "q" })).toThrow(/Invalid regex/i);
  });
  it("valid regex parses", () => {
    expect(parseAssertion({ type: "regex", pattern: "hello" }).type).toBe("regex");
  });
});
