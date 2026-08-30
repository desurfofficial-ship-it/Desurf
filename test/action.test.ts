import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("GitHub Action (action.yml) — offline CI gate", () => {
  it("is a composite Action named Desurf Offline Gate", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/name:\s*Desurf Offline Gate/);
    expect(content).toMatch(/using:\s*composite/);
  });

  it("requires suite input and runs offline desurf test via published package", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/suite:/);
    expect(content).toMatch(/required:\s*true/);
    expect(content).toMatch(/@desurfofficial-ship-it\/desurf/);
    expect(content).toMatch(/npx --yes/);
    expect(content).toMatch(/test --suite/);
    expect(content).not.toMatch(/OPENROUTER_API_KEY\s*:/);
    expect(content).not.toMatch(/--provider\s+openrouter/);
    expect(content).not.toMatch(/\bdesurf record\b/);
  });

  it("documents exit-code propagation 0/1/2 and fails closed on empty suite", async () => {
    const content = await readFile(resolve("action.yml"), "utf8");
    expect(content).toMatch(/0\s*=\s*PASS/);
    expect(content).toMatch(/1\s*=\s*REGRESSION/);
    expect(content).toMatch(/2\s*=\s*ERROR/);
    expect(content).toMatch(/input 'suite' is required/);
    expect(content).toMatch(/exit 2/);
  });
});
