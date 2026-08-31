import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sealSuite } from "../src/seal.js";
import { recordSuite } from "../src/record.js";
import { initSuite } from "../src/init.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";

/**
 * v0.4.3 P0 — JSON verdict integrity regression tests.
 *
 * Every scenario asserts the HUMAN verdict, the JSON verdict, and the exit
 * code, and proves JSON does not silently discard warnings or diffs.
 */

class MockProvider implements ModelAdapter {
  constructor(private response: string) {}
  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    return { text: this.response };
  }
}

function runCli(
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli.ts", ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function makeSuite(
  dir: string,
  name: string,
  cases: Array<{
    id: string;
    input?: string;
    prompt?: string;
    output?: string;
    assertions: unknown[];
  }>
): Promise<void> {
  await mkdir(join(dir, "inputs"), { recursive: true });
  await mkdir(join(dir, "prompts"), { recursive: true });
  await mkdir(join(dir, "outputs"), { recursive: true });
  const prepared = cases.map((c) => {
    const inputFile = `inputs/${c.id}.txt`;
    const promptFile = `prompts/${c.id}.txt`;
    const outputFile = `outputs/${c.id}.json`;
    return {
      id: c.id,
      input: inputFile,
      prompt: promptFile,
      output: outputFile,
      assertions: c.assertions,
    };
  });
  // Write fixture files before suite.json so load-time path checks pass.
  for (const c of cases) {
    await writeFile(join(dir, "inputs", `${c.id}.txt`), c.input ?? `input for ${c.id}\n`, "utf8");
    await writeFile(join(dir, "prompts", `${c.id}.txt`), c.prompt ?? `prompt for ${c.id}\n`, "utf8");
    await writeFile(join(dir, "outputs", `${c.id}.json`), c.output ?? `output for ${c.id}\n`, "utf8");
  }
  await writeFile(
    join(dir, "suite.json"),
    JSON.stringify({ name, cases: prepared }, null, 2) + "\n",
    "utf8"
  );
}

describe("v0.4.3 JSON verdict integrity (P0)", { timeout: 30000 }, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "desurf-json-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("PASS: human PASS, JSON status PASS, exit 0, warnings:0", async () => {
    const suiteDir = join(dir, "pass");
    await makeSuite(suiteDir, "pass", [
      {
        id: "ok",
        output: JSON.stringify({ category: "billing" }) + "\n",
        assertions: [
          { type: "required", value: "billing" },
          { type: "json_schema", schema: { type: "object", required: ["category"] } },
        ],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/PASS/);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(0);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("PASS");
    expect(data.counts.passed).toBe(1);
    expect(data.counts.warnings).toBe(0);
    expect(data.cases[0].executions[0].warnings).toEqual([]);
  });

  it("REGRESSION: human REGRESSION, JSON REGRESSION, exit 1, diff preserved", async () => {
    const suiteDir = join(dir, "reg");
    await makeSuite(suiteDir, "reg", [
      {
        id: "bad",
        output: JSON.stringify({ category: "other" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(1);
    expect(human.stdout).toMatch(/REGRESSION/);
    expect(human.stdout).toMatch(/Required content missing/);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(1);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("REGRESSION");
    expect(data.counts.regression).toBe(1);
    const exec = data.cases[0].executions[0];
    expect(exec.assertionFailures.length).toBeGreaterThan(0);
    expect(exec.assertionFailures[0].message).toMatch(/Required content missing/);
    // Diff field present (null when no baseline differs) — never dropped.
    expect("diff" in exec).toBe(true);
  });

  it("REGRESSION with drift shows diff field present in JSON", async () => {
    const suiteDir = join(dir, "reg-diff");
    await makeSuite(suiteDir, "reg-diff", [
      {
        id: "d",
        output: "old baseline output\n",
        assertions: [{ type: "required", value: "new content" }],
      },
    ]);
    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(1);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("REGRESSION");
    expect(data.cases[0].executions[0].diff).toBe(null);
  });

  it("ERROR (config): human ERROR, JSON ERROR on stdout, exit 2, jq-consumable", async () => {
    const missing = join(dir, "no-such-suite");
    const r = await runCli(["test", "--suite", missing, "--json"]);
    expect(r.code).toBe(2);
    // v0.4.3: structured ERROR JSON must be on STDOUT.
    const data = JSON.parse(r.stdout);
    expect(data.status).toBe("ERROR");
    expect(typeof data.error).toBe("string");
    expect(data.error).toMatch(/Suite file not found/i);
  });

  it("sealed hard drift: human ERROR, JSON ERROR, exit 2", async () => {
    const suiteDir = join(dir, "hard");
    await makeSuite(suiteDir, "hard", [
      {
        id: "c",
        output: JSON.stringify({ category: "billing" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
    ]);
    await sealSuite({ suitePath: suiteDir });
    await writeFile(join(suiteDir, "prompts", "c.txt"), "CHANGED PROMPT\n", "utf8");

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(2);
    expect(human.stdout).toMatch(/ERROR/i);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("ERROR");
    const exec = data.cases[0].executions[0];
    expect(exec.error).toMatch(/Prompt changed/i);
  });

  it("recorded soft drift: human PASS + WARNING, JSON PASS + warnings + drift metadata, exit 0 (soft drift never a silent clean PASS)", async () => {
    const suiteDir = join(dir, "soft");
    await initSuite(suiteDir);
    await recordSuite({
      suitePath: suiteDir,
      provider: new MockProvider(
        JSON.stringify({ category: "technical", reason: "ops" }, null, 2) + "\n"
      ),
      providerName: "openrouter",
      force: true,
    });
    // Drift the prompt so the recorded baseline is stale (soft).
    await writeFile(join(suiteDir, "prompts", "classify.txt"), "CHANGED PROMPT\n", "utf8");

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(0); // contract still passes
    expect(human.stdout).toMatch(/WARNING/);
    expect(human.stdout).toMatch(/drifted recorded baseline/);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(0);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("PASS"); // soft drift keeps exit-code semantics
    expect(data.counts.warnings).toBeGreaterThan(0); // but NOT a clean PASS
    const exec = data.cases[0].executions[0];
    expect(exec.warnings.length).toBeGreaterThan(0);
    expect(exec.warnings[0]).toMatch(/drifted recorded baseline/);
    expect(exec.drift).not.toBeNull();
    expect(exec.drift.state).toBe("soft");
    expect(exec.drift.promptStale).toBe(true);
    expect(exec.drift.cassetteState).toBe("recorded");
  });

  it("unsealed cassette: human UNSEALED indication, JSON cassetteState unsealed, exit 0", async () => {
    const suiteDir = join(dir, "unsealed");
    await makeSuite(suiteDir, "unsealed", [
      {
        id: "u",
        output: JSON.stringify({ category: "billing" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(/UNSEALED/i);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(0);
    const data = JSON.parse(json.stdout);
    expect(data.cases[0].cassetteState).toBe("unsealed");
  });

  it("output tampering (sealed): human ERROR, JSON ERROR + tamper message, exit 2", async () => {
    const suiteDir = join(dir, "tamper");
    await makeSuite(suiteDir, "tamper", [
      {
        id: "t",
        output: JSON.stringify({ category: "billing" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
    ]);
    await sealSuite({ suitePath: suiteDir });
    // Tamper: edit the saved output after sealing.
    await writeFile(
      join(suiteDir, "outputs", "t.json"),
      JSON.stringify({ category: "billing", injected: true }) + "\n",
      "utf8"
    );

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(2);
    expect(human.stdout).toMatch(/modified after sealing/i);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("ERROR");
    expect(data.cases[0].executions[0].error).toMatch(/modified after sealing/i);
  });

  it("recorded-cassette tampering uses 'modified after recording' wording", async () => {
    const suiteDir = join(dir, "tamper-recorded");
    await initSuite(suiteDir);
    await recordSuite({
      suitePath: suiteDir,
      provider: new MockProvider(
        JSON.stringify({ category: "technical", reason: "ops" }, null, 2) + "\n"
      ),
      providerName: "openrouter",
      force: true,
    });
    // Tamper the recorded output.
    await writeFile(
      join(suiteDir, "outputs", "classify.json"),
      JSON.stringify({ category: "technical", reason: "ops", injected: true }, null, 2) + "\n",
      "utf8"
    );

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(2);
    expect(human.stdout).toMatch(/modified after recording/i);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("ERROR");
    expect(data.cases[0].executions[0].error).toMatch(/modified after recording/i);
  });

  it("assertion failure: human REGRESSION, JSON REGRESSION with assertionFailures, exit 1", async () => {
    const suiteDir = join(dir, "assert-fail");
    await makeSuite(suiteDir, "assert-fail", [
      {
        id: "a",
        output: "hello world\n",
        assertions: [{ type: "forbidden", value: "world" }],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(1);
    expect(human.stdout).toMatch(/REGRESSION/);
    expect(human.stdout).toMatch(/Forbidden content present/);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(1);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("REGRESSION");
    const exec = data.cases[0].executions[0];
    expect(exec.assertionFailures.length).toBe(1);
    expect(exec.assertionFailures[0].type).toBe("forbidden");
    expect(exec.assertionFailures[0].message).toMatch(/Forbidden content present/);
  });

  it("mixed cases: independent states in human + JSON, exit reflects worst", async () => {
    const suiteDir = join(dir, "mixed");
    await makeSuite(suiteDir, "mixed", [
      {
        id: "good",
        output: JSON.stringify({ category: "billing" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
      {
        id: "bad",
        output: JSON.stringify({ category: "other" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(1);
    expect(human.stdout).toMatch(/PASS/);
    expect(human.stdout).toMatch(/REGRESSION/);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(1);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("REGRESSION");
    expect(data.counts.passed).toBe(1);
    expect(data.counts.regression).toBe(1);
    const byId = Object.fromEntries(data.cases.map((c: { id: string }) => [c.id, c.state]));
    expect(byId["good"]).toBe("PASS");
    expect(byId["bad"]).toBe("REGRESSION");
  });

  it("malformed suite: human error, JSON ERROR on stdout, exit 2", async () => {
    const suiteDir = join(dir, "malformed");
    await mkdir(suiteDir, { recursive: true });
    await writeFile(join(suiteDir, "suite.json"), '{"name":', "utf8");

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(2);
    expect(human.stderr).toMatch(/Invalid JSON in suite file/i);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("ERROR");
    expect(data.error).toMatch(/Invalid JSON in suite file/i);
  });

  it("invalid assertion: human error, JSON ERROR on stdout, exit 2", async () => {
    const suiteDir = join(dir, "invalid-assert");
    await makeSuite(suiteDir, "invalid-assert", [
      {
        id: "x",
        output: "anything\n",
        assertions: [{ type: "regex", pattern: "([" }],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(2);
    expect(human.stderr).toMatch(/invalid/i);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("ERROR");
  });

  it("corrupted sidecar: human ERROR, JSON ERROR on stdout, exit 2", async () => {
    const suiteDir = join(dir, "corrupt-meta");
    await makeSuite(suiteDir, "corrupt-meta", [
      {
        id: "c",
        output: JSON.stringify({ category: "billing" }) + "\n",
        assertions: [{ type: "required", value: "billing" }],
      },
    ]);
    await sealSuite({ suitePath: suiteDir });
    await writeFile(join(suiteDir, "outputs", "c.json.desurf"), "{not json", "utf8");

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(2);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(2);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("ERROR");
  });

  it("schema type violation via CLI: REGRESSION (exit 1), not ERROR", async () => {
    const suiteDir = join(dir, "schema-type");
    await makeSuite(suiteDir, "schema-type", [
      {
        id: "s",
        output: JSON.stringify({ age: 30 }) + "\n",
        assertions: [
          {
            type: "json_schema",
            schema: {
              type: "object",
              required: ["age"],
              properties: { age: { type: "string" } },
            },
          },
        ],
      },
    ]);

    const human = await runCli(["test", "--suite", suiteDir]);
    expect(human.code).toBe(1); // REGRESSION, never ERROR
    expect(human.stdout).toMatch(/REGRESSION/);

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(1);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("REGRESSION");
    const failures = data.cases[0].executions[0].assertionFailures;
    expect(failures.length).toBe(1);
    expect(failures[0].message).toContain('Property "age" expected a string');
  });

  it("soft-drift JSON is consumable by jq-style parsing (valid JSON, expected keys)", async () => {
    const suiteDir = join(dir, "soft-jq");
    await initSuite(suiteDir);
    await recordSuite({
      suitePath: suiteDir,
      provider: new MockProvider(
        JSON.stringify({ category: "technical", reason: "ops" }, null, 2) + "\n"
      ),
      providerName: "openrouter",
      force: true,
    });
    await writeFile(join(suiteDir, "prompts", "classify.txt"), "CHANGED PROMPT\n", "utf8");

    const json = await runCli(["test", "--suite", suiteDir, "--json"]);
    expect(json.code).toBe(0);
    const data = JSON.parse(json.stdout);
    expect(data.status).toBe("PASS");
    expect(data.counts.warnings).toBe(1);
    expect(data.cases[0].executions[0].drift.state).toBe("soft");
  });

  it("--json error output has no non-JSON stderr pollution on stdout", async () => {
    const missing = join(dir, "definitely-missing");
    const r = await runCli(["test", "--suite", missing, "--json"]);
    expect(r.code).toBe(2);
    expect(r.stdout.trim().startsWith("{")).toBe(true);
    expect(r.stdout.trim().endsWith("}")).toBe(true);
    const parsed = JSON.parse(r.stdout); // would throw if polluted
    expect(parsed.status).toBe("ERROR");
  });
});
