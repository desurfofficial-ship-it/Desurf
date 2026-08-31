import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

function runCli(
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const child = spawn("node", ["dist/cli.js", ...args], {
      cwd: process.cwd(),
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
      resolveP({ code: code ?? 1, stdout, stderr });
    });
  });
}

describe("GitHub Action (action.yml) — offline CI gate", () => {
  it("is a composite Action named Desurf Offline Gate", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/name:\s*Desurf Offline Gate/);
    expect(content).toMatch(/using:\s*composite/);
  });

  it("pins npm package version by default (0.4.1) and rejects latest", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/version:/);
    expect(content).toMatch(/default:\s*"0\.4\.1"/);
    expect(content).toMatch(/Do not use ['"]latest['"]/i);
    expect(content).toMatch(/VER.*=.*"latest"|got '\$\{VER/);
  });

  it("passes inputs via env (shell-safe) and isolates install", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/DESURF_SUITE:\s*\$\{\{\s*inputs\.suite\s*\}\}/);
    expect(content).toMatch(/DESURF_VERSION:\s*\$\{\{\s*inputs\.version\s*\}\}/);
    expect(content).toMatch(/mktemp -d/);
    expect(content).toMatch(/npm install --prefix/);
    expect(content).toMatch(/--no-package-lock/);
    const runBlock = content.split("run: |")[1] ?? "";
    expect(runBlock).not.toMatch(/\$\{\{\s*inputs\./);
  });

  it("requires suite and runs offline desurf test without live provider", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/suite:/);
    expect(content).toMatch(/required:\s*true/);
    expect(content).toMatch(/@desurfofficial-ship-it\/desurf/);
    expect(content).toMatch(/test --suite/);
    expect(content).not.toMatch(/OPENROUTER_API_KEY\s*:/);
    const runBlock = content.split("run: |")[1] ?? "";
    expect(runBlock).not.toMatch(/--provider/);
    expect(runBlock).not.toMatch(/\bdesurf record\b/);
  });

  it("documents exit-code propagation 0/1/2 and fails closed on empty suite", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/0\s*=\s*PASS/);
    expect(content).toMatch(/1\s*=\s*REGRESSION/);
    expect(content).toMatch(/2\s*=\s*ERROR/);
    expect(content).toMatch(/input 'suite' is required/);
    expect(content).toMatch(/exit 2/);
  });

  it("example workflow pins version 0.4.1 and uses the Action", async () => {
    const content = await readFile(
      resolve("examples/github-actions/desurf.yml"),
      "utf8"
    );
    expect(content).toMatch(/uses:\s*desurfofficial-ship-it\/Desurf@/);
    expect(content).toMatch(/version:\s*"0\.4\.1"/);
    expect(content).toMatch(/suite:\s*.+/);
    expect(content).not.toMatch(/OPENROUTER_API_KEY\s*:/);
  });

  it("declares author metadata for consumer discovery", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/author:\s*desurfofficial-ship-it/);
  });

  it("documents Action ref vs npm version and does not invent v0.4 tag usage", async () => {
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(readme).toMatch(/Pins are independent/i);
    expect(readme).toMatch(/@main/);
    expect(readme).toMatch(/commit SHA/i);
    expect(readme).toMatch(/v0\.4.*(?:not|until|planned|reserved)/i);
    const example = await readFile(resolve("examples/github-actions/desurf.yml"), "utf8");
    expect(example).toMatch(/uses:\s*desurfofficial-ship-it\/Desurf@main/);
    expect(example).not.toMatch(/uses:\s*desurfofficial-ship-it\/Desurf@v0\.4/);
  });
});

describe("Desurf exit-code contract (Action quality gate)", () => {
  it("PASS fixture → exit 0", async () => {
    const r = await runCli(["test", "--suite", "fixtures/basic"]);
    expect(r.code).toBe(0);
  });

  it("REGRESSION → exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-action-reg-"));
    try {
      const suite = join(dir, "s");
      await runCli(["init", suite]);
      await rm(join(suite, "outputs", "classify.json.desurf"), { force: true });
      await writeFile(
        join(suite, "outputs", "classify.json"),
        JSON.stringify({ category: "other", reason: "x" }) + "\n",
        "utf8"
      );
      const r = await runCli(["test", "--suite", suite]);
      expect(r.code).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stale sealed cassette → exit 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-action-stale-"));
    try {
      const suite = join(dir, "s");
      await runCli(["init", suite]);
      await writeFile(join(suite, "prompts", "classify.txt"), "CHANGED\n", "utf8");
      const r = await runCli(["test", "--suite", suite]);
      expect(r.code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("missing suite → exit 2", async () => {
    const r = await runCli(["test", "--suite", join(tmpdir(), "no-such-suite-xyz")]);
    expect(r.code).toBe(2);
  });

  it("suite path containing spaces → exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf action space-"));
    try {
      const suite = join(dir, "my suite");
      await runCli(["init", suite]);
      const r = await runCli(["test", "--suite", suite]);
      expect(r.code).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
