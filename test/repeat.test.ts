import { describe, it, expect } from "vitest";
import { classifyReliability, summarizeCase } from "../src/repeat.js";
import type { TestResult } from "../src/types.js";

function pass(id = "c1"): TestResult {
  return { caseId: id, passed: true, assertionResults: [] };
}

function fail(id = "c1"): TestResult {
  return {
    caseId: id,
    passed: false,
    assertionResults: [
      {
        assertion: { type: "required", value: "x" },
        passed: false,
        message: "Required content missing: \"x\"",
      },
    ],
  };
}

function error(id = "c1"): TestResult {
  return {
    caseId: id,
    passed: false,
    assertionResults: [],
    error: "provider failed",
  };
}

describe("classifyReliability", () => {
  it("PASS when all executions pass", () => {
    expect(classifyReliability([pass(), pass(), pass()])).toBe("PASS");
  });

  it("PASS for a single passing execution", () => {
    expect(classifyReliability([pass()])).toBe("PASS");
  });

  it("REGRESSION when all executions fail assertions", () => {
    expect(classifyReliability([fail(), fail(), fail()])).toBe("REGRESSION");
  });

  it("FLAKY when mix of pass and fail (no errors)", () => {
    expect(classifyReliability([pass(), fail(), pass()])).toBe("FLAKY");
    expect(classifyReliability([fail(), pass()])).toBe("FLAKY");
  });

  it("ERROR when any execution has an error", () => {
    expect(classifyReliability([pass(), error(), pass()])).toBe("ERROR");
    expect(classifyReliability([error()])).toBe("ERROR");
    expect(classifyReliability([fail(), error()])).toBe("ERROR");
  });

  it("ERROR for empty executions", () => {
    expect(classifyReliability([])).toBe("ERROR");
  });
});

describe("summarizeCase", () => {
  it("counts pass/fail/error correctly for PASS", () => {
    const s = summarizeCase("support-classifier-good", [pass(), pass(), pass()]);
    expect(s.state).toBe("PASS");
    expect(s.passCount).toBe(3);
    expect(s.failCount).toBe(0);
    expect(s.errorCount).toBe(0);
    expect(s.executions).toHaveLength(3);
  });

  it("counts correctly for FLAKY", () => {
    const s = summarizeCase("c1", [pass(), fail(), pass()]);
    expect(s.state).toBe("FLAKY");
    expect(s.passCount).toBe(2);
    expect(s.failCount).toBe(1);
    expect(s.errorCount).toBe(0);
  });

  it("counts correctly for REGRESSION", () => {
    const s = summarizeCase("c1", [fail(), fail()]);
    expect(s.state).toBe("REGRESSION");
    expect(s.passCount).toBe(0);
    expect(s.failCount).toBe(2);
  });

  it("counts correctly for ERROR", () => {
    const s = summarizeCase("c1", [pass(), error()]);
    expect(s.state).toBe("ERROR");
    expect(s.passCount).toBe(1);
    expect(s.errorCount).toBe(1);
  });
});
