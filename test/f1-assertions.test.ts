/**
 * F1 — max_diff_lines + json_path (T1–T16 / E1–E18)
 */
import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { evaluateAssertion, resolveJsonPath, countChangedLines } from "../src/assertions.js";
import { parseAssertion, loadSuite } from "../src/offline.js";
import { writeCassetteMeta } from "../src/fingerprint.js";
import { recordSuite } from "../src/record.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn("node", ["dist/cli.js", ...args], {
      cwd: process.cwd(),
      env: { ...process.env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolveP({ code: code ?? 1, stdout, stderr }));
  });
}

async function writeBasicSuite(
  root: string,
  opts: {
    output: string;
    assertions: object[];
    input?: string;
    prompt?: string;
  }
) {
  await mkdir(join(root, "inputs"), { recursive: true });
  await mkdir(join(root, "prompts"), { recursive: true });
  await mkdir(join(root, "outputs"), { recursive: true });
  const input = opts.input ?? "hello world\n";
  const prompt = opts.prompt ?? "You are a helper.\n";
  await writeFile(join(root, "inputs", "in.txt"), input, "utf8");
  await writeFile(join(root, "prompts", "sys.txt"), prompt, "utf8");
  const outPath = join(root, "outputs", "out.txt");
  await writeFile(outPath, opts.output, "utf8");
  await writeCassetteMeta(outPath, input, prompt, "seal", opts.output);
  await writeFile(
    join(root, "suite.json"),
    JSON.stringify({
      name: "f1",
      cases: [
        {
          id: "c1",
          input: "inputs/in.txt",
          prompt: "prompts/sys.txt",
          output: "outputs/out.txt",
          assertions: opts.assertions,
        },
      ],
    }),
    "utf8"
  );
}

describe("F1 loader T1/T2", () => {
  it("T1 valid max_diff_lines and json_path shapes load", async () => {
    expect(parseAssertion({ type: "max_diff_lines", value: 0 })).toEqual({
      type: "max_diff_lines",
      value: 0,
    });
    expect(parseAssertion({ type: "max_diff_lines", value: 12 })).toEqual({
      type: "max_diff_lines",
      value: 12,
    });
    expect(
      parseAssertion({ type: "json_path", path: "a.b", equals: 1 })
    ).toMatchObject({ type: "json_path", path: "a.b", equals: 1 });
    expect(
      parseAssertion({ type: "json_path", path: "$.items[0].score", min: 0, max: 1 })
    ).toMatchObject({ path: "$.items[0].score", min: 0, max: 1 });
    expect(
      parseAssertion({ type: "json_path", path: "x", oneOf: ["a", "b"] })
    ).toMatchObject({ oneOf: ["a", "b"] });
  });

  it("T2 E2/E13/E14/E15 config errors", () => {
    expect(() => parseAssertion({ type: "max_diff_lines", value: -1 })).toThrow(/integer/);
    expect(() => parseAssertion({ type: "max_diff_lines", value: 1.5 })).toThrow(/integer/);
    expect(() => parseAssertion({ type: "max_diff_lines", value: "3" as unknown as number })).toThrow();
    expect(() => parseAssertion({ type: "json_path", path: "a..b", equals: 1 })).toThrow(/malformed/);
    expect(() => parseAssertion({ type: "json_path", path: "items[x]", equals: 1 })).toThrow(/malformed/);
    expect(() => parseAssertion({ type: "json_path", path: "a.[0]", equals: 1 })).toThrow(/malformed/);
    expect(() => parseAssertion({ type: "json_path", path: "a.b" } as never)).toThrow(/comparison/);
    expect(() =>
      parseAssertion({ type: "json_path", path: "a", equals: 1, min: 0 } as never)
    ).toThrow(/mutually exclusive/);
    expect(() =>
      parseAssertion({ type: "max_diff_lines", value: 1, extra: true } as never)
    ).toThrow(/unknown/i);
    expect(() =>
      parseAssertion({ type: "json_path", path: "a", equals: 1, foo: 1 } as never)
    ).toThrow(/unknown/i);
  });
});

describe("F1 json_path unit", () => {
  it("T8 equals hit/miss + E17 strict typing", () => {
    const hit = evaluateAssertion(
      { type: "json_path", path: "n", equals: 1 },
      { text: '{"n":1}' }
    );
    expect(hit.passed).toBe(true);
    const miss = evaluateAssertion(
      { type: "json_path", path: "n", equals: "1" },
      { text: '{"n":1}' }
    );
    expect(miss.passed).toBe(false);
    expect(miss.message).toMatch(/expected/);
  });

  it("T9 oneOf", () => {
    expect(
      evaluateAssertion(
        { type: "json_path", path: "s", oneOf: ["a", "b"] },
        { text: '{"s":"b"}' }
      ).passed
    ).toBe(true);
    expect(
      evaluateAssertion(
        { type: "json_path", path: "s", oneOf: ["a", "b"] },
        { text: '{"s":"c"}' }
      ).passed
    ).toBe(false);
  });

  it("T10 min/max inclusive boundaries", () => {
    expect(
      evaluateAssertion(
        { type: "json_path", path: "x", min: 5, max: 10 },
        { text: '{"x":5}' }
      ).passed
    ).toBe(true);
    expect(
      evaluateAssertion(
        { type: "json_path", path: "x", min: 5, max: 10 },
        { text: '{"x":11}' }
      ).passed
    ).toBe(false);
    expect(
      evaluateAssertion(
        { type: "json_path", path: "x", min: 5, max: 10 },
        { text: '{"x":4.9}' }
      ).passed
    ).toBe(false);
  });

  it("T11 deep index path", () => {
    const r = resolveJsonPath(
      { items: [{}, {}, { name: "z" }] },
      "$.items[2].name"
    );
    expect(r.ok && r.value).toBe("z");
  });

  it("T13 path miss is assertion failure", () => {
    const r = evaluateAssertion(
      { type: "json_path", path: "a.missing.deep", equals: 1 },
      { text: '{"a":{}}' }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/resolved to nothing|path/);
  });

  it("T14 non-JSON is assertion failure", () => {
    const r = evaluateAssertion(
      { type: "json_path", path: "a", equals: 1 },
      { text: "not-json" }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/not valid JSON/i);
  });
});

describe("F1 max_diff_lines offline T3–T5", () => {
  it("T3 E3 offline no history → trivial pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "f1-e3-"));
    try {
      await writeBasicSuite(dir, {
        output: "line1\nline2\n",
        assertions: [{ type: "max_diff_lines", value: 0 }],
      });
      const r = await runCli(["test", "--suite", dir]);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/PASS|trivial|diff budget/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T4/T5 offline with history: equal pass, moved fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "f1-hist-"));
    try {
      const baseline = "alpha\nbeta\ngamma\n";
      await writeBasicSuite(dir, {
        output: baseline,
        assertions: [
          { type: "required", value: "alpha" },
          { type: "max_diff_lines", value: 2 },
        ],
      });
      // Create a drifted capture via record+accept to populate baseline-backup
      let n = 0;
      const mock: ModelAdapter = {
        name: "mock",
        async execute(): Promise<ModelOutput> {
          n++;
          return { text: "alpha\nBETA\ngamma\nDELTA\n" }; // more lines
        },
      };
      await recordSuite({
        suitePath: dir,
        provider: mock,
        providerName: "mock",
        force: true,
        fillGaps: false,
        cliVersion: "0.8.0",
      });
      // After force, baseline is the new text; history has baseline-backup of old
      const r = await runCli(["test", "--suite", dir]);
      // Offline compares committed (new) vs retained backup (old) — changed lines > 2
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/diff budget exceeded|changed lines/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("F1 max_diff_lines live T6/T7", () => {
  it("T6 within budget pass; T7 over budget fail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "f1-live-"));
    try {
      await writeBasicSuite(dir, {
        output: "one\ntwo\nthree\n",
        assertions: [{ type: "max_diff_lines", value: 4 }],
      });
      const within: ModelAdapter = {
        name: "mock",
        async execute(): Promise<ModelOutput> {
          return { text: "one\ntwo\nthree\nfour\n" }; // small change
        },
      };
      const { runSuite } = await import("../src/runner.js");
      const ok = await runSuite({ suitePath: dir, provider: within });
      expect(ok.regression + ok.errors).toBe(0);

      // tighter budget
      await writeFile(
        join(dir, "suite.json"),
        JSON.stringify({
          name: "f1",
          cases: [
            {
              id: "c1",
              input: "inputs/in.txt",
              prompt: "prompts/sys.txt",
              output: "outputs/out.txt",
              assertions: [{ type: "max_diff_lines", value: 0 }],
            },
          ],
        }),
        "utf8"
      );
      const over: ModelAdapter = {
        name: "mock",
        async execute(): Promise<ModelOutput> {
          return { text: "completely\ndifferent\noutput\nhere\n" };
        },
      };
      const bad = await runSuite({ suitePath: dir, provider: over });
      expect(bad.regression).toBe(1);
      const msg = bad.cases[0]!.executions[0]!.assertionResults[0]!.message;
      expect(msg).toMatch(/diff budget exceeded/);
      expect(msg).toMatch(/desurf diff/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("F1 integration T15/T16", () => {
  it("T15 legacy fixture still passes offline", async () => {
    const r = await runCli(["test", "--suite", "fixtures/basic"]);
    expect(r.code).toBe(0);
  });

  it("T16 --json surfaces json_path violation in assertionFailures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "f1-json-"));
    try {
      await writeBasicSuite(dir, {
        output: '{"score": 3}\n',
        assertions: [{ type: "json_path", path: "score", equals: 99 }],
      });
      const r = await runCli(["test", "--suite", dir, "--json"]);
      expect(r.code).toBe(1);
      const data = JSON.parse(r.stdout);
      const fails = data.cases[0].executions[0].assertionFailures;
      expect(fails.length).toBeGreaterThan(0);
      expect(fails[0].message).toMatch(/json_path|expected/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("F1 countChangedLines helper", () => {
  it("counts plus/minus excluding headers", () => {
    const d = [
      "--- a",
      "+++ b",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "+extra",
    ].join("\n");
    expect(countChangedLines(d)).toBe(3);
  });
});
