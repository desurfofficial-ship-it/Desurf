import { describe, it, expect } from "vitest";
import { evaluateAssertion, evaluateAssertions } from "../src/assertions.js";
import type { ModelOutput } from "../src/types.js";

const goodOutput: ModelOutput = {
  text: JSON.stringify({
    category: "billing",
    explanation: "Charged twice.",
  }),
};

describe("evaluateAssertion", () => {
  it("required passes when content exists", () => {
    const r = evaluateAssertion(
      { type: "required", value: "billing" },
      goodOutput
    );
    expect(r.passed).toBe(true);
  });

  it("required fails when content missing", () => {
    const r = evaluateAssertion(
      { type: "required", value: "refund" },
      goodOutput
    );
    expect(r.passed).toBe(false);
  });

  it("forbidden passes when content absent", () => {
    const r = evaluateAssertion(
      { type: "forbidden", value: "I am an AI" },
      goodOutput
    );
    expect(r.passed).toBe(true);
  });

  it("forbidden fails when content present", () => {
    const r = evaluateAssertion(
      { type: "forbidden", value: "billing" },
      goodOutput
    );
    expect(r.passed).toBe(false);
  });

  it("regex passes on match", () => {
    const r = evaluateAssertion(
      { type: "regex", pattern: '"category"\\s*:\\s*"billing"' },
      goodOutput
    );
    expect(r.passed).toBe(true);
  });

  it("regex fails on no match", () => {
    const r = evaluateAssertion(
      { type: "regex", pattern: '"category"\\s*:\\s*"technical"' },
      goodOutput
    );
    expect(r.passed).toBe(false);
  });

  it("json_schema passes for valid object with required keys", () => {
    const r = evaluateAssertion(
      {
        type: "json_schema",
        schema: { type: "object", required: ["category", "explanation"] },
      },
      goodOutput
    );
    expect(r.passed).toBe(true);
  });

  it("json_schema fails on invalid JSON", () => {
    const r = evaluateAssertion(
      { type: "json_schema", schema: { type: "object" } },
      { text: "not json" }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toContain("not valid JSON");
  });

  it("json_schema fails when required key missing", () => {
    const r = evaluateAssertion(
      {
        type: "json_schema",
        schema: { type: "object", required: ["category", "missing_key"] },
      },
      goodOutput
    );
    expect(r.passed).toBe(false);
    expect(r.message).toContain("missing_key");
  });
});

describe("evaluateAssertions", () => {
  it("returns one result per assertion", () => {
    const results = evaluateAssertions(
      [
        { type: "required", value: "billing" },
        { type: "forbidden", value: "I am an AI" },
      ],
      goodOutput
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
