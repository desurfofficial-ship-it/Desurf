/**
 * M1 H1 — --json suite key contract + workflow extraction guard
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("M1 H1 contract", () => {
  it("T1: checked-in --json fixtures expose suite + status", async () => {
    const healthy = JSON.parse(
      await readFile(resolve("test/fixtures/json-summary/healthy.json"), "utf8")
    );
    const regression = JSON.parse(
      await readFile(
        resolve("test/fixtures/json-summary/regression.json"),
        "utf8"
      )
    );
    expect(typeof healthy.suite).toBe("string");
    expect(healthy.suite.length).toBeGreaterThan(0);
    expect(healthy.status).toBe("PASS");
    expect(typeof regression.suite).toBe("string");
    expect(regression.suite).toBe(healthy.suite);
    expect(regression.status).toBe("REGRESSION");
  });

  it("T2: drift-watch example extracts .suite // .suiteName", async () => {
    const yml = await readFile(
      resolve("examples/github-actions/desurf-drift-watch.yml"),
      "utf8"
    );
    expect(yml).toContain('.suite // .suiteName // "suite"');
    // Old buggy pattern without the .suite // prefix must be absent
    expect(yml).not.toMatch(/jq -r '\.suiteName \/\/ "suite"'/);
  });
});
