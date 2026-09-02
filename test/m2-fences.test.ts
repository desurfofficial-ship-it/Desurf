/**
 * M2 H2 — allowFences opt-in fence tolerance for json_schema
 */
import { describe, it, expect } from "vitest";
import { evaluateAssertion } from "../src/assertions.js";
import { parseAssertion } from "../src/offline.js";

const schema = {
  type: "object",
  required: ["category"],
  properties: {
    category: { type: "string", const: "billing" },
  },
};

const goodObj = { category: "billing", explanation: "charged twice" };
const goodJson = JSON.stringify(goodObj, null, 2);

describe("M2 H2 allowFences", () => {
  it('T3: allowFences ABSENT; fenced output → exact "Output is not valid JSON"', () => {
    const fenced = "```json\n" + goodJson + "\n```\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema },
      { text: fenced }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toBe("Output is not valid JSON");
  });

  it("T4: allowFences true; ```json language tag → pass + schema checks", () => {
    const fenced = "```json\n" + goodJson + "\n```\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text: fenced }
    );
    expect(r.passed).toBe(true);
    // Wrong const must fail after fence extract
    const bad = evaluateAssertion(
      {
        type: "json_schema",
        schema: {
          type: "object",
          required: ["category"],
          properties: { category: { const: "other" } },
        },
        allowFences: true,
      },
      { text: fenced }
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toMatch(/const/);
  });

  it("T5: allowFences true; bare ``` no language tag → pass", () => {
    const fenced = "```\n" + goodJson + "\n```\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text: fenced }
    );
    expect(r.passed).toBe(true);
  });

  it("T6: allowFences true; prose before and after fence → pass", () => {
    const fenced =
      "Here is the classification:\n```json\n" +
      goodJson +
      "\n```\nHope that helps.\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text: fenced }
    );
    expect(r.passed).toBe(true);
  });

  it("T7: allowFences true; TWO fenced blocks → first wins", () => {
    const first = JSON.stringify({ category: "billing" });
    const second = JSON.stringify({ category: "other" });
    const text =
      "```json\n" + first + "\n```\nprose\n```json\n" + second + "\n```\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text }
    );
    expect(r.passed).toBe(true);
    // If second won, const billing would fail
    const r2 = evaluateAssertion(
      {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { category: { const: "other" } },
        },
        allowFences: true,
      },
      { text }
    );
    expect(r2.passed).toBe(false);
  });

  it('T8: allowFences true; fence content not JSON → exact "Output is not valid JSON"', () => {
    const text = "```json\nnot-json-at-all\n```\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text }
    );
    expect(r.passed).toBe(false);
    expect(r.message).toBe("Output is not valid JSON");
  });

  it("T9: allowFences true; BOM + CRLF + fence → pass", () => {
    const body = goodJson.replace(/\n/g, "\r\n");
    const text = "\uFEFF```json\r\n" + body + "\r\n```\r\n";
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text }
    );
    expect(r.passed).toBe(true);
  });

  it('V1: allowFences non-boolean → load error', () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema,
        allowFences: "yes" as unknown as boolean,
      })
    ).toThrow(/must be a boolean/);
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema,
        allowFences: 1 as unknown as boolean,
      })
    ).toThrow(/must be a boolean/);
  });

  it("V2: allowFences undefined vs false → deeply equal on fenced input", () => {
    const fenced = "```json\n" + goodJson + "\n```\n";
    const a = evaluateAssertion(
      { type: "json_schema", schema },
      { text: fenced }
    );
    const b = evaluateAssertion(
      { type: "json_schema", schema, allowFences: false },
      { text: fenced }
    );
    expect(a.passed).toBe(false);
    expect(b.passed).toBe(false);
    expect(a.message).toBe(b.message);
    expect(a.message).toBe("Output is not valid JSON");
  });

  it("V3: allowFences true; bare valid JSON (no fences) → pass via strict path", () => {
    const r = evaluateAssertion(
      { type: "json_schema", schema, allowFences: true },
      { text: goodJson }
    );
    expect(r.passed).toBe(true);
  });
});
