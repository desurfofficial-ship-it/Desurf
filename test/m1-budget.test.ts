/**
 * M1 H3 — structural changed-line counting + truncation detection
 */
import { describe, it, expect } from "vitest";
import {
  countChangedLines,
  evaluateAssertion,
} from "../src/assertions.js";
import {
  unifiedDiff,
  countChangedLinesBetween,
} from "../src/diff.js";

describe("M1 H3 budget counting", () => {
  it("T10: one-line edit containing the word truncated counts as 2", () => {
    const oldT = "alpha\n";
    const newT = "line with truncated word\n";
    expect(countChangedLinesBetween(oldT, newT)).toBe(2);
    const rendered = unifiedDiff(oldT, newT, 2000);
    expect(countChangedLines(rendered)).toBe(2);
    const r = evaluateAssertion(
      { type: "max_diff_lines", value: 1 },
      { text: newT },
      { baselineReference: oldT }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/diff budget exceeded: 2 changed lines > 1/);
    expect(r.message).not.toMatch(/display truncated|more lines truncated/i);
  });

  it("T11: prose maxLines/lines omitted is not truncation; only terminal marker is", () => {
    const body = [
      "@@ -1 +1 @@",
      "-old",
      "+new with maxLines and lines omitted in prose",
    ].join("\n");
    expect(countChangedLines(body)).toBe(2);
    // Not a terminal marker → evaluateMaxDiffLines displayCapped path
    const r = evaluateAssertion(
      { type: "max_diff_lines", value: 0 },
      { text: "new with maxLines and lines omitted in prose\n" },
      { baselineReference: "old\n" }
    );
    expect(r.passed).toBe(false);
    expect(r.message).not.toMatch(/budget computed on full texts/);
  });

  it("T12: >2000-line drift against small budget uses exact count + display note", () => {
    const oldT = "base\n";
    const newT = Array.from({ length: 2500 }, (_, i) => `line-${i}`).join("\n") + "\n";
    const changed = countChangedLinesBetween(oldT, newT);
    expect(changed).toBeGreaterThan(2000);
    const r = evaluateAssertion(
      { type: "max_diff_lines", value: 5 },
      { text: newT },
      { baselineReference: oldT }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(
      new RegExp(`diff budget exceeded: ${changed} changed lines > 5`)
    );
    expect(r.message).toMatch(
      /budget computed on full texts; diff display truncated at 2000 lines/
    );
    expect(r.message).not.toMatch(/≥/);
  });

  it("helper edges: equal, insert, delete, empty", () => {
    expect(countChangedLinesBetween("a\n", "a\n")).toBe(0);
    expect(countChangedLinesBetween("", "")).toBe(0);
    expect(countChangedLinesBetween("", "x\ny\n")).toBe(2);
    expect(countChangedLinesBetween("x\ny\n", "")).toBe(2);
    expect(countChangedLinesBetween("a\r\nb\r\n", "a\nb\n")).toBe(0);
  });

  it("property: countChangedLinesBetween matches uncapped countChangedLines", () => {
    for (let i = 0; i < 200; i++) {
      const a = `seed-${i}\n` + "x".repeat(i % 7) + "\n";
      const b = `seed-${i}\n` + "y".repeat((i + 3) % 9) + "\n";
      const exact = countChangedLinesBetween(a, b);
      const rendered = unifiedDiff(a, b, 100000);
      expect(countChangedLines(rendered)).toBe(exact);
    }
  });

  it("countChangedLines: marker skipped; +line containing marker text still counted", () => {
    const withMarker = [
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "... (3 more lines truncated)",
    ].join("\n");
    expect(countChangedLines(withMarker)).toBe(2);
    const adversarial = [
      "@@ -1 +1 @@",
      "-old",
      "+... (3 more lines truncated)",
    ].join("\n");
    // line starts with + so counted even though it looks like the marker
    expect(countChangedLines(adversarial)).toBe(2);
  });

  it("byte-compat: within budget, no display cap → same within-budget message shape", () => {
    const r = evaluateAssertion(
      { type: "max_diff_lines", value: 10 },
      { text: "a\nb\n" },
      { baselineReference: "a\n" }
    );
    expect(r.passed).toBe(true);
    expect(r.message).toMatch(/diff budget 10: \d+ changed lines \(within budget\)/);
  });
});
