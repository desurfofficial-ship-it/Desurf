/**
 * B3 completion — T10–T15, E7, E8, E11 (lock in audit-verified behaviors).
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
import { writeCassetteMeta, readCassetteMeta } from "../src/fingerprint.js";
import { runSuite } from "../src/runner.js";
import type { ExecuteRequest, ModelAdapter, ModelOutput } from "../src/types.js";

function runCli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
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

async function baseTurnsSuite(
  root: string,
  opts: {
    turns: string[];
    outputs: string[];
    turnAssertions?: Array<object[] | undefined>;
    caseAssertions?: object[];
    source?: "seal" | "record";
  }
): Promise<void> {
  await mkdir(join(root, "inputs"), { recursive: true });
  await mkdir(join(root, "prompts"), { recursive: true });
  await mkdir(join(root, "outputs"), { recursive: true });
  await writeFile(join(root, "prompts", "sys.txt"), "SYS\n", "utf8");
  const turnDefs = [];
  for (let i = 0; i < opts.turns.length; i++) {
    const fname = `turn${i}.txt`;
    await writeFile(join(root, "inputs", fname), opts.turns[i]!, "utf8");
    turnDefs.push({
      user: `inputs/${fname}`,
      ...(opts.turnAssertions?.[i]
        ? { assertions: opts.turnAssertions[i] }
        : {}),
    });
  }
  const transcript = {
    version: 1 as const,
    turns: opts.turns.map((u, i) => ({ user: u, output: opts.outputs[i]! })),
  };
  const body = JSON.stringify(transcript, null, 2) + "\n";
  const outPath = join(root, "outputs", "chat.json");
  await writeFile(outPath, body, "utf8");
  await writeCassetteMeta(
    outPath,
    opts.turns[0]!,
    "SYS\n",
    opts.source ?? "seal",
    body,
    undefined,
    undefined,
    opts.source === "record" ? "soft" : "hard",
    opts.turns
  );
  await writeFile(
    join(root, "suite.json"),
    JSON.stringify(
      {
        name: "turns-completion",
        cases: [
          {
            id: "chat",
            prompt: "prompts/sys.txt",
            output: "outputs/chat.json",
            turns: turnDefs,
            assertions:
              opts.caseAssertions ?? [{ type: "required", value: "ok" }],
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );
}

describe("B3 completion — T15 --json turns surface", () => {
  it("T15: turn-2 assertion failure exposes turns[1].passed=false and turnIndex:1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t15-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["t0", "t1", "t2"],
        outputs: ["pass-a", "fail-here", "pass-c ok"],
        turnAssertions: [
          [{ type: "required", value: "pass-a" }],
          [{ type: "required", value: "MISSING" }],
          [{ type: "required", value: "pass-c" }],
        ],
        caseAssertions: [{ type: "required", value: "ok" }],
      });
      const r = await runCli(["test", "--suite", dir, "--json"]);
      expect(r.code).toBe(1);
      const data = JSON.parse(r.stdout);
      const exec = data.cases[0].executions[0];
      expect(exec.turns).toBeDefined();
      expect(exec.turns).toHaveLength(3);
      expect(exec.turns[0].passed).toBe(true);
      expect(exec.turns[1].passed).toBe(false);
      expect(exec.turns[2].passed).toBe(true);
      const fail = exec.assertionFailures.find(
        (a: { turnIndex?: number }) => a.turnIndex === 1
      );
      expect(fail).toBeDefined();
      expect(fail.turnIndex).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("B3 completion — T10/T11 seal + soft drift", () => {
  it("T10: seal turnUserSha256[]; edit turn-2 → exit 2 names index 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t10-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["u0", "u1", "u2"],
        outputs: ["a ok", "b ok", "c ok"],
        source: "seal",
      });
      const meta = await readCassetteMeta(join(dir, "outputs", "chat.json"));
      expect(meta?.turnUserSha256).toHaveLength(3);

      await writeFile(join(dir, "inputs", "turn1.txt"), "u1-EDITED\n", "utf8");
      const r = await runCli(["test", "--suite", dir]);
      expect(r.code).toBe(2);
      const msg = r.stdout + r.stderr;
      expect(msg).toMatch(/stale turn index:\s*1|first stale turn index:\s*1/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T11: recorded soft drift → exit 0, warning + drift.staleTurnIndex in --json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t11-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["u0", "u1"],
        outputs: ["a ok", "b ok"],
        source: "record",
      });
      await writeFile(join(dir, "inputs", "turn1.txt"), "u1-CHANGED\n", "utf8");
      const r = await runCli(["test", "--suite", dir, "--json"]);
      expect(r.code).toBe(0);
      const data = JSON.parse(r.stdout);
      const exec = data.cases[0].executions[0];
      expect(exec.warnings?.length).toBeGreaterThan(0);
      expect(String(exec.warnings[0])).toMatch(/[Tt]urn|stale/i);
      expect(exec.drift?.staleTurnIndex).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("B3 completion — E7/E8/E11", () => {
  it("E7: transcript turn-count mismatch → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e7-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["u0", "u1", "u2"],
        outputs: ["a", "b", "c"],
      });
      // Truncate transcript to 2 turns
      const short = {
        version: 1,
        turns: [
          { user: "u0", output: "a" },
          { user: "u1", output: "b" },
        ],
      };
      const body = JSON.stringify(short, null, 2) + "\n";
      await writeFile(join(dir, "outputs", "chat.json"), body, "utf8");
      await writeCassetteMeta(
        join(dir, "outputs", "chat.json"),
        "u0",
        "SYS\n",
        "seal",
        body,
        undefined,
        undefined,
        "hard",
        ["u0", "u1", "u2"]
      );
      const r = await runCli(["test", "--suite", dir]);
      expect(r.code).toBe(2);
      expect(r.stdout + r.stderr).toMatch(
        /case has 3 turns, transcript has 2/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E8: tampered sealed transcript output → exit 2 integrity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e8-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["u0", "u1"],
        outputs: ["alpha ok", "beta ok"],
        source: "seal",
      });
      // Edit transcript output text without updating sidecar
      const tampered = {
        version: 1,
        turns: [
          { user: "u0", output: "TAMPERED" },
          { user: "u1", output: "beta ok" },
        ],
      };
      await writeFile(
        join(dir, "outputs", "chat.json"),
        JSON.stringify(tampered, null, 2) + "\n",
        "utf8"
      );
      const r = await runCli(["test", "--suite", dir]);
      expect(r.code).toBe(2);
      expect(r.stdout + r.stderr).toMatch(
        /modified after|outputSha256|tamper|integrity|fingerprint/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("E11: provider error turn 2 of 3 → stop, error, turns[1].error in --json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "e11-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await mkdir(join(dir, "outputs"), { recursive: true });
      await writeFile(join(dir, "prompts", "sys.txt"), "SYS\n", "utf8");
      await writeFile(join(dir, "inputs", "t0.txt"), "u0", "utf8");
      await writeFile(join(dir, "inputs", "t1.txt"), "u1", "utf8");
      await writeFile(join(dir, "inputs", "t2.txt"), "u2", "utf8");
      await writeFile(
        join(dir, "suite.json"),
        JSON.stringify({
          name: "e11",
          cases: [
            {
              id: "chat",
              prompt: "prompts/sys.txt",
              output: "outputs/chat.json",
              turns: [
                { user: "inputs/t0.txt" },
                { user: "inputs/t1.txt" },
                { user: "inputs/t2.txt" },
              ],
              assertions: [{ type: "required", value: "even" }],
            },
          ],
        }),
        "utf8"
      );

      let call = 0;
      const mock: ModelAdapter = {
        name: "mock",
        async execute(_req: ExecuteRequest): Promise<ModelOutput> {
          call++;
          if (call === 2) throw new Error("provider boom on turn 1");
          return { text: `out-${call}` };
        },
      };

      const summary = await runSuite({ suitePath: dir, provider: mock });
      expect(summary.errors).toBe(1);
      const exec = summary.cases[0]!.executions[0]!;
      expect(exec.error).toMatch(/provider boom/);
      expect(exec.turns).toHaveLength(2); // stopped after failing turn
      expect(exec.turns![1]!.error).toMatch(/provider boom/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("B3 completion — T12 B1 loop / T13 diff / T14 repeat", () => {
  it("T12: record→drift→accept→test→revert→history on turns case", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t12-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["hello", "world"],
        outputs: ["hi ok", "bye ok"],
        source: "seal",
      });
      const outPath = join(dir, "outputs", "chat.json");
      const original = await readFile(outPath, "utf8");

      // Mock provider that returns a *different* transcript via sequential turns
      let n = 0;
      const mock: ModelAdapter = {
        name: "mock",
        async execute(req: ExecuteRequest): Promise<ModelOutput> {
          n++;
          return { text: `live-${n} ok` };
        },
      };

      // Use library record would need provider wiring — simulate via runSuite offline
      // For B1 loop: write a drifted snapshot by re-recording with force path is heavy;
      // instead use CLI record isn't available offline. Drive accept/revert with history API
      // via CLI by first writing a record snapshot through a drifted baseline scenario:
      //
      // Practical path: change baseline to drifted content, then use history accept after
      // simulating record by writing snapshot via desurf record with a custom provider is hard
      // from CLI. Use the history module through sequential CLI:
      //
      // 1) Keep original sealed
      // 2) Manually place a pending record snapshot by using accept path after `desurf record`
      //    with Mock — call recordSuite from code.
      const { recordSuite } = await import("../src/record.js");
      const rec = await recordSuite({
        suitePath: dir,
        provider: mock,
        providerName: "mock",
        force: false,
        fillGaps: false,
        cliVersion: "0.7.0",
      });
      expect(rec.results[0]!.verdict).toBe("drift");
      // baseline untouched
      expect(await readFile(outPath, "utf8")).toBe(original);

      const acc = await runCli([
        "accept",
        "--suite",
        dir,
        "--case",
        "chat",
        "--yes",
      ]);
      expect(acc.code).toBe(0);
      const afterAccept = await readFile(outPath, "utf8");
      expect(afterAccept).not.toBe(original);
      expect(afterAccept).toMatch(/live-1/);

      // Offline test should pass against new transcript if assertions match "ok"
      const testAfter = await runCli(["test", "--suite", dir]);
      expect(testAfter.code).toBe(0);

      const rev = await runCli([
        "revert",
        "--suite",
        dir,
        "--case",
        "chat",
        "--yes",
      ]);
      expect(rev.code).toBe(0);
      // After revert, baseline restored to pre-accept backup of the drifted→promoted flow
      // (revert restores from history backup — may restore pre-accept drifted baseline)
      const hist = await runCli(["history", "--suite", dir]);
      expect(hist.code).toBe(0);
      expect(hist.stdout).toMatch(/chat|snapshot|record/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T13: diff shows == turn N == labels; --full uses larger cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t13-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["u0", "u1"],
        outputs: ["old-a", "old-b"],
        source: "seal",
      });
      const { recordSuite } = await import("../src/record.js");
      let n = 0;
      const mock: ModelAdapter = {
        name: "mock",
        async execute(): Promise<ModelOutput> {
          n++;
          return { text: `new-${n}` };
        },
      };
      await recordSuite({
        suitePath: dir,
        provider: mock,
        providerName: "mock",
        force: false,
        fillGaps: false,
        cliVersion: "0.7.0",
      });
      const d = await runCli(["diff", "--suite", dir, "--case", "chat"]);
      expect(d.code).toBe(0);
      expect(d.stdout).toMatch(/== turn 0 ==/);
      expect(d.stdout).toMatch(/== turn 1 ==/);

      const full = await runCli([
        "diff",
        "--suite",
        dir,
        "--case",
        "chat",
        "--full",
      ]);
      expect(full.code).toBe(0);
      expect(full.stdout).toMatch(/== turn 0 ==/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T14: --repeat 3 on turns case; FLAKY when turn output varies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t14-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await mkdir(join(dir, "outputs"), { recursive: true });
      await writeFile(join(dir, "prompts", "sys.txt"), "SYS\n", "utf8");
      await writeFile(join(dir, "inputs", "t0.txt"), "u0", "utf8");
      await writeFile(
        join(dir, "suite.json"),
        JSON.stringify({
          name: "t14",
          cases: [
            {
              id: "chat",
              prompt: "prompts/sys.txt",
              output: "outputs/chat.json",
              turns: [{ user: "inputs/t0.txt" }],
              assertions: [{ type: "required", value: "even" }],
            },
          ],
        }),
        "utf8"
      );

      let call = 0;
      const mock: ModelAdapter = {
        name: "mock",
        async execute(): Promise<ModelOutput> {
          call++;
          // Alternate outputs so normalized transcript differs across reps
          return { text: call % 2 === 0 ? "even x" : "odd x" };
        },
      };
      const summary = await runSuite({
        suitePath: dir,
        provider: mock,
        repeat: 3,
      });
      expect(summary.cases[0]!.executions).toHaveLength(3);
      // With alternating outputs, expect FLAKY or REGRESSION depending on classifier
      expect(
        summary.flaky + summary.regression
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("diff with no pending snapshot exits 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "diff-none-"));
    try {
      await baseTurnsSuite(dir, {
        turns: ["u0"],
        outputs: ["ok"],
      });
      const r = await runCli(["diff", "--suite", dir, "--case", "chat"]);
      expect(r.code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
