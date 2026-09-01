/** B3 M1 — multi-turn schema, loader, offline replay (T1–T6, T16). */
import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { loadSuite } from "../src/offline.js";
import { runSuite } from "../src/runner.js";
import { writeCassetteMeta } from "../src/fingerprint.js";

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn("node", ["dist/cli.js", ...args], { cwd: process.cwd(), env: { ...process.env } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolveP({ code: code ?? 1, stdout, stderr }));
  });
}

async function writeTurnsSuite(
  root: string,
  opts: {
    id?: string;
    turns: Array<{ user: string; assertions?: object[] }>;
    caseAssertions?: object[];
    transcript: { version: 1; turns: Array<{ user: string; output: string }> };
    outputName?: string;
    alsoLegacy?: boolean;
  }
): Promise<void> {
  await mkdir(join(root, "inputs"), { recursive: true });
  await mkdir(join(root, "prompts"), { recursive: true });
  await mkdir(join(root, "outputs"), { recursive: true });
  await writeFile(join(root, "prompts", "sys.txt"), "You are a helpful assistant.\n", "utf8");
  const turnDefs = [];
  for (let i = 0; i < opts.turns.length; i++) {
    const t = opts.turns[i]!;
    const fname = `turn${i}.txt`;
    await writeFile(join(root, "inputs", fname), t.user, "utf8");
    turnDefs.push({ user: `inputs/${fname}`, ...(t.assertions ? { assertions: t.assertions } : {}) });
  }
  const outName = opts.outputName ?? "chat.json";
  const outPath = join(root, "outputs", outName);
  const body = JSON.stringify(opts.transcript, null, 2) + "\n";
  await writeFile(outPath, body, "utf8");
  await writeCassetteMeta(outPath, opts.turns[0]?.user ?? "", "You are a helpful assistant.\n", "seal", body);
  const caseObj: Record<string, unknown> = {
    id: opts.id ?? "chat",
    prompt: "prompts/sys.txt",
    output: `outputs/${outName}`,
    turns: turnDefs,
    assertions: opts.caseAssertions ?? [{ type: "required", value: "ok" }],
  };
  const cases: object[] = [caseObj];
  if (opts.alsoLegacy) {
    await writeFile(join(root, "inputs", "legacy.txt"), "legacy in\n", "utf8");
    await writeFile(join(root, "outputs", "legacy.txt"), "legacy out contains billing\n", "utf8");
    await writeCassetteMeta(join(root, "outputs", "legacy.txt"), "legacy in\n", "You are a helpful assistant.\n", "seal", "legacy out contains billing\n");
    cases.push({
      id: "legacy",
      input: "inputs/legacy.txt",
      prompt: "prompts/sys.txt",
      output: "outputs/legacy.txt",
      assertions: [{ type: "required", value: "billing" }],
    });
  }
  await writeFile(join(root, "suite.json"), JSON.stringify({ name: "turns-suite", cases }, null, 2), "utf8");
}

describe("B3 turns M1", () => {
  it("T1: turns loads; legacy fixtures/basic exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t1-"));
    try {
      await writeTurnsSuite(dir, {
        turns: [{ user: "hello" }, { user: "follow up" }],
        transcript: { version: 1, turns: [{ user: "hello", output: "hi ok" }, { user: "follow up", output: "sure ok" }] },
      });
      const suite = await loadSuite(dir);
      expect(suite.cases[0]!.turns).toHaveLength(2);
      expect(suite.cases[0]!.input).toBeUndefined();
      expect((await runCli(["test", "--suite", "fixtures/basic"])).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2 E1 empty turns → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e1-"));
    try {
      await mkdir(join(dir, "prompts"), { recursive: true });
      await writeFile(join(dir, "prompts", "s.txt"), "s\n", "utf8");
      await writeFile(join(dir, "suite.json"), JSON.stringify({
        name: "e", cases: [{ id: "c", prompt: "prompts/s.txt", output: "outputs/c.json", turns: [], assertions: [{ type: "required", value: "x" }] }],
      }), "utf8");
      await expect(loadSuite(dir)).rejects.toThrow(/1–20|got 0/i);
      expect((await runCli(["test", "--suite", dir])).code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2 E2 >20 turns → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e2-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await writeFile(join(dir, "prompts", "s.txt"), "s\n", "utf8");
      await writeFile(join(dir, "inputs", "t.txt"), "u\n", "utf8");
      await writeFile(join(dir, "suite.json"), JSON.stringify({
        name: "e",
        cases: [{
          id: "c", prompt: "prompts/s.txt", output: "outputs/c.json",
          turns: Array.from({ length: 21 }, () => ({ user: "inputs/t.txt" })),
          assertions: [{ type: "required", value: "x" }],
        }],
      }), "utf8");
      await expect(loadSuite(dir)).rejects.toThrow(/20-turn cap/i);
      expect((await runCli(["test", "--suite", dir])).code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2 E4 turns+input → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e4-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await writeFile(join(dir, "prompts", "s.txt"), "s\n", "utf8");
      await writeFile(join(dir, "inputs", "t.txt"), "u\n", "utf8");
      await writeFile(join(dir, "suite.json"), JSON.stringify({
        name: "e",
        cases: [{
          id: "c", input: "inputs/t.txt", prompt: "prompts/s.txt", output: "outputs/c.json",
          turns: [{ user: "inputs/t.txt" }], assertions: [{ type: "required", value: "x" }],
        }],
      }), "utf8");
      await expect(loadSuite(dir)).rejects.toThrow(/mutually exclusive/i);
      expect((await runCli(["test", "--suite", dir])).code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2 E5 output not .json → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e5-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await writeFile(join(dir, "prompts", "s.txt"), "s\n", "utf8");
      await writeFile(join(dir, "inputs", "t.txt"), "u\n", "utf8");
      await writeFile(join(dir, "suite.json"), JSON.stringify({
        name: "e",
        cases: [{
          id: "c", prompt: "prompts/s.txt", output: "outputs/c.txt",
          turns: [{ user: "inputs/t.txt" }], assertions: [{ type: "required", value: "x" }],
        }],
      }), "utf8");
      await expect(loadSuite(dir)).rejects.toThrow(/\.json/i);
      expect((await runCli(["test", "--suite", dir])).code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T2 E14 unknown turn field → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e14-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await writeFile(join(dir, "prompts", "s.txt"), "s\n", "utf8");
      await writeFile(join(dir, "inputs", "t.txt"), "u\n", "utf8");
      await writeFile(join(dir, "suite.json"), JSON.stringify({
        name: "e",
        cases: [{
          id: "c", prompt: "prompts/s.txt", output: "outputs/c.json",
          turns: [{ user: "inputs/t.txt", role: "system" }],
          assertions: [{ type: "required", value: "x" }],
        }],
      }), "utf8");
      await expect(loadSuite(dir)).rejects.toThrow(/unknown field/i);
      expect((await runCli(["test", "--suite", dir])).code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T3 single-entry turns offline green", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t3-"));
    try {
      await writeTurnsSuite(dir, {
        turns: [{ user: "only turn" }],
        transcript: { version: 1, turns: [{ user: "only turn", output: "reply ok" }] },
      });
      const r = await runSuite({ suitePath: dir });
      expect(r.passed).toBe(1);
      expect(r.cases[0]!.executions[0]!.turns).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T4 multi-turn offline e2e exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t4-"));
    try {
      await writeTurnsSuite(dir, {
        turns: [
          { user: "hi", assertions: [{ type: "required", value: "hello" }] },
          { user: "bye", assertions: [{ type: "required", value: "goodbye" }] },
        ],
        transcript: {
          version: 1,
          turns: [
            { user: "hi", output: "hello there" },
            { user: "bye", output: "goodbye friend" },
          ],
        },
        caseAssertions: [{ type: "required", value: "goodbye" }],
      });
      expect((await runCli(["test", "--suite", dir])).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T5 E10 assertion fails mid-conversation continues; exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t5-"));
    try {
      await writeTurnsSuite(dir, {
        turns: [
          { user: "t0", assertions: [{ type: "required", value: "A" }] },
          { user: "t1", assertions: [{ type: "required", value: "MISSING-B" }] },
          { user: "t2", assertions: [{ type: "required", value: "MISSING-C" }] },
        ],
        transcript: {
          version: 1,
          turns: [
            { user: "t0", output: "A ok" },
            { user: "t1", output: "nope" },
            { user: "t2", output: "still no" },
          ],
        },
        caseAssertions: [{ type: "required", value: "still" }],
      });
      const summary = await runSuite({ suitePath: dir });
      expect(summary.regression).toBe(1);
      const exec = summary.cases[0]!.executions[0]!;
      expect(exec.turns).toHaveLength(3);
      expect(exec.turns![0]!.passed).toBe(true);
      expect(exec.turns![1]!.passed).toBe(false);
      expect(exec.turns![2]!.passed).toBe(false);
      const idxs = exec.assertionResults.filter((a) => !a.passed && a.turnIndex !== undefined).map((a) => a.turnIndex);
      expect(idxs).toContain(1);
      expect(idxs).toContain(2);
      expect((await runCli(["test", "--suite", dir])).code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T6 case-level assertions hit last turn only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t6-"));
    try {
      await writeTurnsSuite(dir, {
        turns: [{ user: "t0" }, { user: "t1" }],
        transcript: {
          version: 1,
          turns: [
            { user: "t0", output: "first has SECRET" },
            { user: "t1", output: "second clean" },
          ],
        },
        caseAssertions: [{ type: "required", value: "SECRET" }],
      });
      expect((await runSuite({ suitePath: dir })).cases[0]!.executions[0]!.passed).toBe(false);

      const dir2 = await mkdtemp(join(tmpdir(), "t6b-"));
      await writeTurnsSuite(dir2, {
        turns: [{ user: "t0" }, { user: "t1" }],
        transcript: {
          version: 1,
          turns: [
            { user: "t0", output: "first" },
            { user: "t1", output: "last has SECRET" },
          ],
        },
        caseAssertions: [{ type: "required", value: "SECRET" }],
      });
      expect((await runSuite({ suitePath: dir2 })).passed).toBe(1);
      await rm(dir2, { recursive: true, force: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T16 mixed legacy + turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t16-"));
    try {
      await writeTurnsSuite(dir, {
        turns: [{ user: "hi" }, { user: "bye" }],
        transcript: {
          version: 1,
          turns: [
            { user: "hi", output: "hello ok" },
            { user: "bye", output: "bye ok" },
          ],
        },
        alsoLegacy: true,
      });
      const summary = await runSuite({ suitePath: dir });
      expect(summary.cases).toHaveLength(2);
      expect(summary.passed).toBe(2);
      expect((await runCli(["test", "--suite", dir])).code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
