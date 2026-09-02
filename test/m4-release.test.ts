/**
 * M4 — release guard: fetch-depth, pin surfaces, version lockstep
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("M4 release guards", () => {
  it("S4a: both publish.yml checkouts set fetch-depth: 0", async () => {
    const yml = await readFile(resolve(".github/workflows/publish.yml"), "utf8");
    const auditBlock = yml.slice(
      yml.indexOf("audit-gate:"),
      yml.indexOf("\n  publish:")
    );
    const publishBlock = yml.slice(yml.indexOf("\n  publish:"));
    expect(auditBlock).toMatch(/fetch-depth:\s*0/);
    expect(publishBlock).toMatch(/fetch-depth:\s*0/);
  });

  it("S4b: no 0.8.0 remains on pin surfaces", async () => {
    const files = [
      "package.json",
      "action.yml",
      "README.md",
      "docs/publishing.md",
      "docs/dogfooding.md",
      "docs/cli-contract.md",
      "examples/github-actions/desurf.yml",
      "examples/github-actions/desurf-drift-watch.yml",
      ".github/workflows/desurf-drift-watch.yml",
    ];
    for (const f of files) {
      const t = await readFile(resolve(f), "utf8");
      // dogfooding may still mention historical 0.8.0 soak — pin rows should be 0.9.0
      if (f === "docs/dogfooding.md") {
        expect(t).toMatch(/@desurfofficial-ship-it\/desurf@0\.9\.0/);
        expect(t).toMatch(/Desurf version \| 0\.9\.0/);
        continue;
      }
      if (f === ".github/workflows/desurf-drift-watch.yml") {
        expect(t).toMatch(/VER="0\.9\.0"/);
        expect(t).not.toMatch(/0\.8\.0/);
        continue;
      }
      expect(t, f).not.toMatch(/0\.8\.0/);
    }
  });

  it("S4c: package.json version equals cli.ts fallback literal", async () => {
    const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      version: string;
    };
    const cli = await readFile(resolve("src/cli.ts"), "utf8");
    const m = cli.match(/return "(\d+\.\d+\.\d+)";/);
    expect(m).toBeTruthy();
    expect(m![1]).toBe(pkg.version);
  });
});
