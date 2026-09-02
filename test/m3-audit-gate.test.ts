/**
 * M3 H4/H6 — audit-gate.sh functional + static checks; cookbook/TEMPLATE presence
 */
import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  readFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { cpSync } from "node:fs";

function runGate(
  cwd: string,
  env: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const c = spawn("bash", ["ci/audit-gate.sh"], {
      cwd,
      env: { ...process.env, ...env },
    });
    let o = "", e = "";
    c.stdout.on("data", (d) => (o += d));
    c.stderr.on("data", (d) => (e += d));
    c.on("close", (code) => res({ code: code ?? 1, stdout: o, stderr: e }));
  });
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "t@test",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "t@test",
    },
  });
}

async function fixtureRepo(opts: {
  version: string;
  doc?: string | null;
}): Promise<{ dir: string; head: string }> {
  const dir = await mkdtemp(join(tmpdir(), "audit-gate-"));
  git(dir, ["init", "-q"]);
  git(dir, ["-c", "user.email=t@test", "-c", "user.name=t", "checkout", "-b", "main"]);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "x", version: opts.version }, null, 2) + "\n"
  );
  await mkdir(join(dir, "docs", "audits"), { recursive: true });
  await mkdir(join(dir, "ci"), { recursive: true });
  // copy real gate script
  const srcGate = resolve("ci/audit-gate.sh");
  cpSync(srcGate, join(dir, "ci", "audit-gate.sh"));
  await chmod(join(dir, "ci", "audit-gate.sh"), 0o755);
  git(dir, ["add", "-A"]);
  git(dir, [
    "-c",
    "user.email=t@test",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    "init",
  ]);
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  if (opts.doc !== null && opts.doc !== undefined) {
    await writeFile(join(dir, "docs", "audits", `v${opts.version}.md`), opts.doc);
    git(dir, ["add", "-A"]);
    git(dir, [
      "-c",
      "user.email=t@test",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "-m",
      "audit doc",
    ]);
  }
  const head2 = git(dir, ["rev-parse", "HEAD"]).trim();
  return { dir, head: head2 };
}

describe("M3 H4 audit gate", () => {
  it("T13a: real repo root gate matches package.json audit doc presence", async () => {
    const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      version: string;
    };
    const docPath = resolve(`docs/audits/v${pkg.version}.md`);
    const { existsSync } = await import("node:fs");
    const r = await runGate(resolve("."));
    const out = r.stdout + r.stderr;
    if (!existsSync(docPath)) {
      expect(r.code).toBe(1);
      expect(out).toContain(`docs/audits/v${pkg.version}.md`);
      expect(out).toMatch(/AUDIT-VERDICT: PASS/);
      expect(out).toMatch(/Audited-commit:/);
    } else {
      expect(r.code).toBe(0);
      expect(out).toMatch(/AUDIT GATE PASS/);
    }
  });

  it("T13b: publish.yml has audit-gate before publish and needs: audit-gate", async () => {
    const yml = await readFile(resolve(".github/workflows/publish.yml"), "utf8");
    const auditIdx = yml.indexOf("audit-gate:");
    const publishIdx = yml.indexOf("\n  publish:");
    expect(auditIdx).toBeGreaterThan(0);
    expect(publishIdx).toBeGreaterThan(auditIdx);
    expect(yml).toMatch(/publish:\s*\n\s*needs:\s*audit-gate/);
  });

  it("T13c: no waiver surface on publish workflow", async () => {
    const yml = await readFile(resolve(".github/workflows/publish.yml"), "utf8");
    // workflow_dispatch only has tag input
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).toMatch(/inputs:\s*\n\s*tag:/);
    // No skip/waiver/force inputs or env overrides (ignore "skipping publish" log text)
    expect(yml).not.toMatch(/\b(skip_audit|waiver|force_publish|FORCE_PUBLISH)\b/i);
    expect(yml).not.toMatch(/inputs:[\s\S]*?(skip|waiver|force)\s*:/i);
    // no if: on audit-gate job
    const auditBlock = yml.slice(
      yml.indexOf("audit-gate:"),
      yml.indexOf("\n  publish:")
    );
    expect(auditBlock).not.toMatch(/\bif:/);
  });

  it("T14a: PASS but deadbeef SHA → exit 1 ancestor", async () => {
    const { dir } = await fixtureRepo({
      version: "0.9.0",
      doc: "AUDIT-VERDICT: PASS\nAudited-commit: deadbeef\n",
    });
    try {
      const r = await runGate(dir);
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/ancestor|does not resolve|Audited-commit/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T14b: PASS + real HEAD sha → exit 0", async () => {
    const { dir, head } = await fixtureRepo({ version: "0.9.0", doc: null });
    try {
      await writeFile(
        join(dir, "docs", "audits", "v0.9.0.md"),
        `AUDIT-VERDICT: PASS\nAudited-commit: ${head}\n`
      );
      // doc on working tree is enough; gate does not require commit of the doc for existence
      const r = await runGate(dir);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/AUDIT GATE PASS/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T14c: AUDIT-VERDICT: FAIL → exit 1", async () => {
    const { dir, head } = await fixtureRepo({ version: "0.9.0", doc: null });
    try {
      await writeFile(
        join(dir, "docs", "audits", "v0.9.0.md"),
        `AUDIT-VERDICT: FAIL\nAudited-commit: ${head}\n`
      );
      const r = await runGate(dir);
      expect(r.code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T14d: PASS but no Audited-commit line → exit 1", async () => {
    const { dir } = await fixtureRepo({ version: "0.9.0", doc: null });
    try {
      await writeFile(
        join(dir, "docs", "audits", "v0.9.0.md"),
        `AUDIT-VERDICT: PASS\n`
      );
      const r = await runGate(dir);
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/Audited-commit/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("T14e: AUDIT_TAG v0.8.0 vs package 0.9.0 → exit 1", async () => {
    const { dir, head } = await fixtureRepo({ version: "0.9.0", doc: null });
    try {
      await writeFile(
        join(dir, "docs", "audits", "v0.9.0.md"),
        `AUDIT-VERDICT: PASS\nAudited-commit: ${head}\n`
      );
      const r = await runGate(dir, { AUDIT_TAG: "v0.8.0" });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).toMatch(/does not match package\.json version/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("M3 H6 docs", () => {
  it("S1: TEMPLATE.md has machine lines + checklist topics", async () => {
    const t = await readFile(resolve("docs/audits/TEMPLATE.md"), "utf8");
    expect(t).toMatch(/AUDIT-VERDICT:\s*PASS/);
    expect(t).toMatch(/Audited-commit:/);
    expect(t).toMatch(/suite green|Full suite green/i);
    expect(t).toMatch(/Zero production dependencies|npm ls --prod/i);
    expect(t).toMatch(/Golden-master/i);
    expect(t).toMatch(/mirror-URL|registry\.npmjs\.org/i);
    expect(t).toMatch(/pin bump|pin the new semver/i);
    expect(t).toMatch(/Exit-code|exit 0|REGRESSION/i);
  });

  it("S2: assertions-cookbook has four sections + snippets", async () => {
    const t = await readFile(resolve("docs/assertions-cookbook.md"), "utf8");
    expect(t).toMatch(/## 1\. Volatile literals/);
    expect(t).toMatch(/## 2\. Fences and allowFences/);
    expect(t).toMatch(/## 3\. Budget sizing/);
    expect(t).toMatch(/## 4\. Provider errors/);
    expect(t.match(/```/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("S3: test-case-schema cross-link present", async () => {
    const t = await readFile(resolve("docs/test-case-schema.md"), "utf8");
    expect(t).toMatch(/assertions-cookbook\.md/);
  });
});
