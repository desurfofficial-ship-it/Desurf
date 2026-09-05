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

  /**
   * S4d — doc trust alignment.
   *
   * v1.0.1 shipped with a README that said "Version 1.0.0" in the headline,
   * the quickstart `--version` comment, the Action pin example, and the
   * default-pin explanation — while the package, Action default, and npm
   * `latest` were all 1.0.1. S4b only required that the current version
   * appear *somewhere*, so the stale pins survived the release audit.
   *
   * For a product whose entire thesis is "trust the verdict", the docs
   * contradicting themselves about what is installed is a trust defect.
   * This guard pins the active (non-historical) version surfaces to the
   * package version. Historical prose (feature-section headings like
   * "## v0.7.0", dogfooding soak evidence, audit transcripts) is out of
   * scope by design.
   */
  it("S4d: active doc version pins equal package.json version", async () => {
    const pkg = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      version: string;
    };
    const EXPECTED = pkg.version;
    const esc = EXPECTED.replace(/\./g, "\\.");

    // README: headline version, quickstart --version comment, Action pin example.
    const readme = await readFile(resolve("README.md"), "utf8");

    expect(readme, "README headline 'Version **x.y.z**'").toMatch(
      new RegExp(`Version \\*\\*${esc}\\*\\*`)
    );

    const versionComments = [
      ...readme.matchAll(/--version\s*#\s*(\d+\.\d+\.\d+)/g),
    ].map((m) => m[1]!);
    expect(
      versionComments.length,
      "README --version expected-output comments"
    ).toBeGreaterThan(0);
    expect(versionComments.every((v) => v === EXPECTED)).toBe(true);

    const readmePins = [
      ...readme.matchAll(/version:\s*"(\d+\.\d+\.\d+)"/g),
    ].map((m) => m[1]!);
    expect(readmePins.length, "README version: \"...\" pins").toBeGreaterThan(0);
    expect(readmePins.every((v) => v === EXPECTED)).toBe(true);

    // README must not carry stale "planned vX tag" language for releases
    // that were already cut (v0.4 shipped long before v1.x).
    expect(readme).not.toMatch(/v0\.4` Action tag.*planned/i);

    // cli-contract / publishing: every `version: "<semver>"` example pin is
    // the current version. publishing.md legitimately has zero such pins
    // (its tag example is generic `v<version>`); cli-contract carries the
    // Action example and must have at least one.
    for (const f of ["docs/cli-contract.md", "docs/publishing.md"]) {
      const td = await readFile(resolve(f), "utf8");
      const pins = [...td.matchAll(/version:\s*"(\d+\.\d+\.\d+)"/g)].map(
        (m) => m[1]!
      );
      if (f === "docs/cli-contract.md") {
        expect(pins.length, f).toBeGreaterThan(0);
      }
      expect(pins.every((v) => v === EXPECTED), f).toBe(true);
    }

    // cli-contract: stable-release footer and publishing: current-version
    // line must name the published version.
    const cliContract = await readFile(resolve("docs/cli-contract.md"), "utf8");
    expect(cliContract).toMatch(
      new RegExp(`Current stable release: \\*\\*${esc}\\*\\*`)
    );
    const publishing = await readFile(resolve("docs/publishing.md"), "utf8");
    expect(publishing).toMatch(
      new RegExp(`Current version: \\*\\*${esc}\\*\\*`)
    );

    // cold-start is the live first-60-seconds recipe (not historical
    // evidence — that lives under docs/audits/): every install pin must be
    // the current version.
    const coldStart = await readFile(resolve("docs/cold-start.md"), "utf8");
    const installPins = [
      ...coldStart.matchAll(/desurf@(\d+\.\d+\.\d+)/g),
    ].map((m) => m[1]!);
    expect(installPins.length, "cold-start install pins").toBeGreaterThan(0);
    expect(installPins.every((v) => v === EXPECTED)).toBe(true);

    // package-lock.json is committed and CI runs `npm install`, so its root
    // version fields must track package.json. (They said 1.0.0 after the
    // 1.0.1 release bump — an `npm ci` switch would have failed on the
    // mismatch, and the committed lockfile disagreed with the published
    // artifact version.)
    const lock = JSON.parse(
      await readFile(resolve("package-lock.json"), "utf8")
    ) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(EXPECTED);
    expect(lock.packages[""]?.version).toBe(EXPECTED);
  });
});
