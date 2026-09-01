import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const LIB = resolve("examples/github-actions/drift-watch/lib.sh");
function bash(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const c = spawn("bash", ["-c", script], { env: process.env });
    let o = "", e = "";
    c.stdout.on("data", (d) => (o += d));
    c.stderr.on("data", (d) => (e += d));
    c.on("close", (code) => res({ code: code ?? 1, stdout: o, stderr: e }));
  });
}

describe("classify_run", () => {
  it("precedence and corrupt → infra", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dw-"));
    try {
      const f = join(dir, "s.json");
      const write = async (cases: object[]) => {
        await writeFile(f, JSON.stringify({ suiteName: "s", cases, passed: 0, flaky: 0, regression: 0, errors: 0 }));
      };
      await write([{ caseId: "a", state: "REGRESSION", passCount: 0, failCount: 1, errorCount: 0, executions: [] }]);
      expect((await bash(`source "${LIB}"; classify_run "${f}"`)).stdout.trim()).toBe("drift");
      await write([{ caseId: "a", state: "ERROR", passCount: 0, failCount: 0, errorCount: 1, executions: [] }]);
      expect((await bash(`source "${LIB}"; classify_run "${f}"`)).stdout.trim()).toBe("infra");
      await write([{ caseId: "a", state: "FLAKY", passCount: 1, failCount: 1, errorCount: 0, executions: [] }]);
      expect((await bash(`source "${LIB}"; classify_run "${f}"`)).stdout.trim()).toBe("flaky");
      await write([{ caseId: "a", state: "PASS", passCount: 1, failCount: 0, errorCount: 0, executions: [] }]);
      expect((await bash(`source "${LIB}"; classify_run "${f}"`)).stdout.trim()).toBe("healthy");
      await writeFile(f, "{bad");
      expect((await bash(`source "${LIB}"; classify_run "${f}"`)).stdout.trim()).toBe("infra");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("workflow static", () => {
  it("schedule only, no keys, pinned", async () => {
    const c = await readFile(resolve("examples/github-actions/desurf-drift-watch.yml"), "utf8");
    expect(c).toMatch(/schedule:/);
    expect(c).toMatch(/workflow_dispatch:/);
    expect(c).not.toMatch(/pull_request:/);
    expect(c).toMatch(/issues:\s*write/);
    expect(c).toMatch(/concurrency:/);
    expect(c).toMatch(/timeout-minutes:\s*15/);
    expect(c).not.toMatch(/version:\s*["']latest["']/);
    expect(c).toMatch(/secrets\.OPENROUTER_API_KEY/);
  });
});
