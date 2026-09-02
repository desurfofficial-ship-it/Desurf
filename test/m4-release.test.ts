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

it("S4b: pin surfaces carry the current version", async () => {
    const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      version: string;
    };
    const EXPECTED = pkg.version;
    const esc = EXPECTED.replace(/\./g, "\\.");

    // action.yml default
    const action = await readFile(resolve("action.yml"), "utf8");
    expect(action).toMatch(new RegExp(`default:\\s*"${esc}"`));

    // example composite workflow pin
    const ex = await readFile(resolve("examples/github-actions/desurf.yml"), "utf8");
    expect(ex).toMatch(new RegExp(esc));

    // example + installed drift-watch VER pin
    for (const f of [
      "examples/github-actions/desurf-drift-watch.yml",
      ".github/workflows/desurf-drift-watch.yml",
    ]) {
      const tw = await readFile(resolve(f), "utf8");
      expect(tw, f).toMatch(new RegExp(`VER="${esc}"`));
      // no other semver VER= on that line style with different version
      const vers = [...tw.matchAll(/VER="(\d+\.\d+\.\d+)"/g)].map((m) => m[1]);
      expect(vers.every((v) => v === EXPECTED), f).toBe(true);
    }

    // README + publishing + cli-contract should mention current version
    for (const f of ["README.md", "docs/publishing.md", "docs/cli-contract.md"]) {
      const td = await readFile(resolve(f), "utf8");
      expect(td, f).toMatch(new RegExp(esc));
    }

    // dogfooding: current pin present; historical 0.8.0 soak language allowed
    const dog = await readFile(resolve("docs/dogfooding.md"), "utf8");
    expect(dog).toMatch(
      new RegExp(`@desurfofficial-ship-it/desurf@${esc}`)
    );
    expect(dog).toMatch(new RegExp(`Desurf version \\| ${esc}`));

    // When on 1.0.0, active pins must not retain 0.9.0 / 0.8.0 VER=
    if (EXPECTED === "1.0.0") {
      for (const f of [
        "action.yml",
        "examples/github-actions/desurf.yml",
        "examples/github-actions/desurf-drift-watch.yml",
        ".github/workflows/desurf-drift-watch.yml",
      ]) {
        const tf = await readFile(resolve(f), "utf8");
        expect(tf, f).not.toMatch(/0\.9\.0|0\.8\.0/);
      }
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
