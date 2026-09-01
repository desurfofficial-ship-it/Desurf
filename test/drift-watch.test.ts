import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const LIB = resolve("examples/github-actions/drift-watch/lib.sh");

function bash(
  script: string,
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const c = spawn("bash", ["-c", script], {
      env: { ...process.env, ...env },
    });
    let o = "", e = "";
    c.stdout.on("data", (d) => (o += d));
    c.stderr.on("data", (d) => (e += d));
    c.on("close", (code) => res({ code: code ?? 1, stdout: o, stderr: e }));
  });
}

function summary(cases: object[], suiteName = "demo-suite"): string {
  return JSON.stringify({
    suiteName,
    cases,
    passed: cases.filter((c: any) => c.state === "PASS").length,
    flaky: cases.filter((c: any) => c.state === "FLAKY").length,
    regression: cases.filter((c: any) => c.state === "REGRESSION").length,
    errors: cases.filter((c: any) => c.state === "ERROR").length,
  });
}

/** Install a fake `gh` on PATH that logs argv to a file and can simulate open issues. */
async function installGhStub(
  binDir: string,
  logPath: string,
  options: { openIssues?: Array<{ number: number; body: string; labels: string[] }> } = {}
): Promise<void> {
  const statePath = join(binDir, "gh-state.json");
  await writeFile(
    statePath,
    JSON.stringify({ openIssues: options.openIssues ?? [] }),
    "utf8"
  );
  const script = `#!/usr/bin/env bash
set -euo pipefail
LOG="${logPath}"
STATE="${statePath}"
echo "gh $*" >> "$LOG"
# issue list --json number,body
if [[ "$*" == *"issue list"* ]]; then
  jq -c '[.openIssues[] | {number, body}]' "$STATE"
  exit 0
fi
# issue create
if [[ "$*" == *"issue create"* ]]; then
  echo "https://github.com/example/repo/issues/99"
  exit 0
fi
# issue comment / close
if [[ "$*" == *"issue comment"* ]] || [[ "$*" == *"issue close"* ]]; then
  exit 0
fi
exit 0
`;
  const ghPath = join(binDir, "gh");
  await writeFile(ghPath, script, "utf8");
  await chmod(ghPath, 0o755);
}

describe("classify_run (T-A…T-F)", () => {
  let dir: string;
  let summaryPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dw-cls-"));
    summaryPath = join(dir, "summary.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("T-A: REGRESSION fixture → drift", async () => {
    await writeFile(
      summaryPath,
      summary([{ caseId: "a", state: "REGRESSION", passCount: 0, failCount: 1 }])
    );
    const r = await bash(`source "${LIB}"; classify_run "${summaryPath}"`);
    expect(r.stdout.trim()).toBe("drift");
    expect(r.code).toBe(0);
  });

  it("T-B: ERROR fixture → infra", async () => {
    await writeFile(
      summaryPath,
      summary([{ caseId: "a", state: "ERROR", passCount: 0, failCount: 0, errorCount: 1 }])
    );
    const r = await bash(`source "${LIB}"; classify_run "${summaryPath}"`);
    expect(r.stdout.trim()).toBe("infra");
  });

  it("T-C: FLAKY fixture → flaky", async () => {
    await writeFile(
      summaryPath,
      summary([{ caseId: "a", state: "FLAKY", passCount: 1, failCount: 1 }])
    );
    const r = await bash(`source "${LIB}"; classify_run "${summaryPath}"`);
    expect(r.stdout.trim()).toBe("flaky");
  });

  it("T-D: all-PASS fixture → healthy", async () => {
    await writeFile(
      summaryPath,
      summary([
        { caseId: "a", state: "PASS", passCount: 3, failCount: 0 },
        { caseId: "b", state: "PASS", passCount: 3, failCount: 0 },
      ])
    );
    const r = await bash(`source "${LIB}"; classify_run "${summaryPath}"`);
    expect(r.stdout.trim()).toBe("healthy");
  });

  it("T-E: corrupt JSON → infra; missing file → infra", async () => {
    await writeFile(summaryPath, "{not-json");
    expect(
      (await bash(`source "${LIB}"; classify_run "${summaryPath}"`)).stdout.trim()
    ).toBe("infra");
    expect(
      (await bash(`source "${LIB}"; classify_run "${join(dir, "nope.json")}"`)).stdout.trim()
    ).toBe("infra");
  });

  it("T-F: REGRESSION+ERROR+FLAKY → drift (precedence)", async () => {
    await writeFile(
      summaryPath,
      summary([
        { caseId: "e", state: "ERROR", passCount: 0, failCount: 0, errorCount: 1 },
        { caseId: "f", state: "FLAKY", passCount: 1, failCount: 1 },
        { caseId: "r", state: "REGRESSION", passCount: 0, failCount: 2 },
      ])
    );
    const r = await bash(`source "${LIB}"; classify_run "${summaryPath}"`);
    expect(r.stdout.trim()).toBe("drift");
  });
});

describe("act lifecycle (T-G…T-J)", () => {
  let dir: string;
  let binDir: string;
  let logPath: string;
  let summaryPath: string;
  const suiteName = "demo-suite";
  const context = JSON.stringify({
    suite: "./desurf-suite",
    provider: "openrouter",
    exitCode: "1",
    timestamp: "2026-09-01T00:00:00Z",
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dw-act-"));
    binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    logPath = join(dir, "gh.log");
    summaryPath = join(dir, "summary.json");
    await writeFile(logPath, "", "utf8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("T-G: act drift → issue create with desurf-drift label", async () => {
    await installGhStub(binDir, logPath, { openIssues: [] });
    await writeFile(
      summaryPath,
      summary(
        [{ caseId: "c1", state: "REGRESSION", passCount: 0, failCount: 2 }],
        suiteName
      )
    );
    const r = await bash(
      `export PATH="${binDir}:$PATH"; source "${LIB}"; act drift "${suiteName}" "${summaryPath}" '${context}'`,
      { GITHUB_REPOSITORY: "desurfofficial-ship-it/Desurf", GH_TOKEN: "fake" }
    );
    expect(r.code).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toMatch(/issue create/);
    expect(log).toMatch(/desurf-drift/);
    expect(log).toMatch(new RegExp(suiteName));
  });

  it("T-H: second act drift → comment, not duplicate create", async () => {
    const marker = `suite-fingerprint:${suiteName}`;
    await installGhStub(binDir, logPath, {
      openIssues: [
        {
          number: 42,
          body: `<!-- ${marker} -->\nprior drift`,
          labels: ["desurf-drift"],
        },
      ],
    });
    await writeFile(
      summaryPath,
      summary(
        [{ caseId: "c1", state: "REGRESSION", passCount: 0, failCount: 1 }],
        suiteName
      )
    );
    const r = await bash(
      `export PATH="${binDir}:$PATH"; source "${LIB}"; act drift "${suiteName}" "${summaryPath}" '${context}'`,
      { GITHUB_REPOSITORY: "desurfofficial-ship-it/Desurf", GH_TOKEN: "fake" }
    );
    expect(r.code).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toMatch(/issue comment/);
    expect(log).not.toMatch(/issue create/);
  });

  it("T-I: act healthy → closes open issue with recovered comment", async () => {
    const marker = `suite-fingerprint:${suiteName}`;
    await installGhStub(binDir, logPath, {
      openIssues: [
        {
          number: 7,
          body: `<!-- ${marker} -->\nold drift`,
          labels: ["desurf-drift"],
        },
      ],
    });
    await writeFile(
      summaryPath,
      summary([{ caseId: "c1", state: "PASS", passCount: 3, failCount: 0 }], suiteName)
    );
    const r = await bash(
      `export PATH="${binDir}:$PATH"; source "${LIB}"; act healthy "${suiteName}" "${summaryPath}" '${context}'`,
      { GITHUB_REPOSITORY: "desurfofficial-ship-it/Desurf", GH_TOKEN: "fake" }
    );
    expect(r.code).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toMatch(/issue comment/);
    expect(log).toMatch(/issue close/);
  });

  it("T-J: act infra → label desurf-infra", async () => {
    await installGhStub(binDir, logPath, { openIssues: [] });
    await writeFile(
      summaryPath,
      summary(
        [{ caseId: "c1", state: "ERROR", passCount: 0, failCount: 0, errorCount: 1 }],
        suiteName
      )
    );
    const r = await bash(
      `export PATH="${binDir}:$PATH"; source "${LIB}"; act infra "${suiteName}" "${summaryPath}" '${context}'`,
      { GITHUB_REPOSITORY: "desurfofficial-ship-it/Desurf", GH_TOKEN: "fake" }
    );
    expect(r.code).toBe(0);
    const log = await readFile(logPath, "utf8");
    expect(log).toMatch(/issue create/);
    expect(log).toMatch(/desurf-infra/);
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

describe("unifiedDiff maxLines", () => {
  it("default caps at 200 lines with truncation marker", async () => {
    const { unifiedDiff } = await import("../src/diff.js");
    const oldT = Array.from({ length: 300 }, (_, i) => `old-${i}`).join("\n");
    const newT = Array.from({ length: 300 }, (_, i) => `new-${i}`).join("\n");
    const d = unifiedDiff(oldT, newT);
    const lines = d.split("\n");
    // header + capped body + marker
    expect(lines.length).toBeLessThanOrEqual(202);
    expect(d).toMatch(/\.\.\. \(\d+ more lines truncated\)/);
  });

  it("full mode (2000) renders >200 lines without early truncate", async () => {
    const { unifiedDiff } = await import("../src/diff.js");
    const oldT = Array.from({ length: 250 }, (_, i) => `old-${i}`).join("\n");
    const newT = Array.from({ length: 250 }, (_, i) => `new-${i}`).join("\n");
    const d = unifiedDiff(oldT, newT, 2000);
    const lines = d.split("\n");
    expect(lines.length).toBeGreaterThan(200);
    expect(d).not.toMatch(/more lines truncated/);
  });
});
