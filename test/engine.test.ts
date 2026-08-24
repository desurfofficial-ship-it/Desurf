import { describe, it, expect } from "vitest";
import { evaluateTestCase } from "../src/engine.js";
import type { TestCase, ModelOutput } from "../src/types.js";

const testCase: TestCase = {
  id: "support-classifier-good",
  input: "/tmp/input.txt",
  prompt: "/tmp/prompt.txt",
  outputPath: "/tmp/output.json",
  assertions: [
    { type: "required", value: "billing" },
    { type: "forbidden", value: "I am an AI" },
    {
      type: "json_schema",
      schema: { type: "object", required: ["category", "explanation"] },
    },
  ],
};

const goodOutput: ModelOutput = {
  text: JSON.stringify({
    category: "billing",
    explanation: "Charged twice.",
  }),
};

describe("evaluateTestCase", () => {
  it("passes when all assertions pass", () => {
    const result = evaluateTestCase(testCase, goodOutput);
    expect(result.passed).toBe(true);
    expect(result.caseId).toBe("support-classifier-good");
    expect(result.assertionResults).toHaveLength(3);
  });

  it("fails when any assertion fails", () => {
    const bad: ModelOutput = {
      text: JSON.stringify({ category: "other", explanation: "Something" }),
    };
    // required "billing" will fail
    const result = evaluateTestCase(testCase, bad);
    expect(result.passed).toBe(false);
  });
});
