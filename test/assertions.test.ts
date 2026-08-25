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

  it("malformed regex does not throw; returns failed assertion", () => {
    const r = evaluateAssertion(
      { type: "regex", pattern: "[unterminated" },
      goodOutput
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/Invalid regex/i);
  });

  it("invalid regex flags do not throw; returns failed assertion", () => {
    const r = evaluateAssertion(
      { type: "regex", pattern: "abc", flags: "q" },
      goodOutput
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/Invalid regex/i);
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
      { text: "not-json" }
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

describe("caseSensitive", () => {
  const mixed: ModelOutput = { text: "As an AI language model, I can help." };

  it("default required is case-sensitive", () => {
    const r = evaluateAssertion({ type: "required", value: "as an ai" }, mixed);
    expect(r.passed).toBe(false);
  });

  it("caseSensitive true required is case-sensitive", () => {
    const r = evaluateAssertion(
      { type: "required", value: "as an ai", caseSensitive: true },
      mixed
    );
    expect(r.passed).toBe(false);
  });

  it("caseSensitive false required matches ignoring case", () => {
    const r = evaluateAssertion(
      { type: "required", value: "as an ai", caseSensitive: false },
      mixed
    );
    expect(r.passed).toBe(true);
  });

  it("default forbidden is case-sensitive", () => {
    const r = evaluateAssertion({ type: "forbidden", value: "as an ai" }, mixed);
    expect(r.passed).toBe(true);
  });

  it("caseSensitive false forbidden detects different case", () => {
    const r = evaluateAssertion(
      { type: "forbidden", value: "as an ai", caseSensitive: false },
      mixed
    );
    expect(r.passed).toBe(false);
  });
});

describe("json_schema const and enum", () => {
  const billing: ModelOutput = {
    text: JSON.stringify({ category: "billing", explanation: "x" }),
  };
  const other: ModelOutput = {
    text: JSON.stringify({ category: "other", explanation: "x" }),
  };

  it("const pass", () => {
    const r = evaluateAssertion(
      {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { category: { const: "billing" } },
        },
      },
      billing
    );
    expect(r.passed).toBe(true);
  });

  it("const failure against parsed value", () => {
    const r = evaluateAssertion(
      {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { category: { const: "billing" } },
        },
      },
      other
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/const/i);
  });

  it("enum pass", () => {
    const r = evaluateAssertion(
      {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            category: { enum: ["billing", "technical"] },
          },
        },
      },
      billing
    );
    expect(r.passed).toBe(true);
  });

  it("enum failure against parsed value", () => {
    const r = evaluateAssertion(
      {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            category: { enum: ["billing", "technical"] },
          },
        },
      },
      other
    );
    expect(r.passed).toBe(false);
    expect(r.message).toMatch(/enum/i);
  });
});
