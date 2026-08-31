import { describe, it, expect } from "vitest";
import { evaluateAssertion } from "../src/assertions.js";
import { parseAssertion } from "../src/offline.js";
import type { ModelOutput } from "../src/types.js";

/**
 * v0.4.3 P1 — json_schema property-level type enforcement.
 *
 * Defect 2 (adversarial dogfood): json_schema property-level "type" was
 * ignored, producing false PASS. E.g. schema
 * `{"type":"object","required":["age"],"properties":{"age":{"type":"string"}}}`
 * with output `{"age":30}` returned PASS; it must be REGRESSION (exit 1),
 * never ERROR.
 */

function evalSchema(schema: Record<string, unknown>, text: string) {
  return evaluateAssertion(
    { type: "json_schema", schema },
    { text } as ModelOutput
  );
}

describe("json_schema property-level type enforcement (P1)", () => {
  it("valid property type passes (string)", () => {
    const r = evalSchema(
      {
        type: "object",
        required: ["age"],
        properties: { age: { type: "string" } },
      },
      JSON.stringify({ age: "30" })
    );
    expect(r.passed).toBe(true);
  });

  it("invalid property type is REGRESSION (string vs number)", () => {
    const r = evalSchema(
      {
        type: "object",
        required: ["age"],
        properties: { age: { type: "string" } },
      },
      JSON.stringify({ age: 30 })
    );
    expect(r.passed).toBe(false);
    expect(r.message).toContain('Property "age" expected a string');
  });

  it("number accepts any JSON number and rejects strings", () => {
    const ok = evalSchema(
      { type: "object", properties: { n: { type: "number" } } },
      JSON.stringify({ n: 1.5 })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      { type: "object", properties: { n: { type: "number" } } },
      JSON.stringify({ n: "1.5" })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain("expected a number");
  });

  it("integer rejects fractional values and accepts whole numbers", () => {
    const ok = evalSchema(
      { type: "object", properties: { n: { type: "integer" } } },
      JSON.stringify({ n: 42 })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      { type: "object", properties: { n: { type: "integer" } } },
      JSON.stringify({ n: 1.5 })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain("expected an integer");
  });

  it("number vs integer are distinct (integer schema rejects 1.5; number schema accepts it)", () => {
    const intBad = evalSchema(
      { type: "object", properties: { n: { type: "integer" } } },
      JSON.stringify({ n: 1.5 })
    );
    expect(intBad.passed).toBe(false);

    const numOk = evalSchema(
      { type: "object", properties: { n: { type: "number" } } },
      JSON.stringify({ n: 1.5 })
    );
    expect(numOk.passed).toBe(true);
  });

  it("boolean property type is enforced", () => {
    const ok = evalSchema(
      { type: "object", properties: { ok: { type: "boolean" } } },
      JSON.stringify({ ok: true })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      { type: "object", properties: { ok: { type: "boolean" } } },
      JSON.stringify({ ok: "true" })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain("expected a boolean");
  });

  it("null property type matches only JSON null", () => {
    const ok = evalSchema(
      { type: "object", properties: { n: { type: "null" } } },
      JSON.stringify({ n: null })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      { type: "object", properties: { n: { type: "null" } } },
      JSON.stringify({ n: 0 })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain("expected null");
  });

  it("array property type is enforced", () => {
    const ok = evalSchema(
      { type: "object", properties: { tags: { type: "array" } } },
      JSON.stringify({ tags: ["a", "b"] })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      { type: "object", properties: { tags: { type: "array" } } },
      JSON.stringify({ tags: "a" })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain("expected an array");
  });

  it("array items schema validates each element", () => {
    const ok = evalSchema(
      {
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" } } },
      },
      JSON.stringify({ tags: ["a", "b"] })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      {
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" } } },
      },
      JSON.stringify({ tags: ["a", 42] })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain("expected a string");
  });

  it("nested object property type is enforced recursively", () => {
    const schema = {
      type: "object",
      required: ["user"],
      properties: {
        user: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
        },
      },
    };

    const ok = evalSchema(
      schema,
      JSON.stringify({ user: { name: "alice", age: 30 } })
    );
    expect(ok.passed).toBe(true);

    const badType = evalSchema(
      schema,
      JSON.stringify({ user: { name: "alice", age: "30" } })
    );
    expect(badType.passed).toBe(false);
    expect(badType.message).toContain('Property "user.age" expected an integer');

    const missingRequired = evalSchema(
      schema,
      JSON.stringify({ user: { age: 30 } })
    );
    expect(missingRequired.passed).toBe(false);
    expect(missingRequired.message).toContain('missing required key: "name"');
  });

  it("multiple properties are each checked independently", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
        active: { type: "boolean" },
      },
    };
    const ok = evalSchema(
      schema,
      JSON.stringify({ name: "bob", age: 5, active: true })
    );
    expect(ok.passed).toBe(true);

    const bad = evalSchema(
      schema,
      JSON.stringify({ name: "bob", age: 5, active: "yes" })
    );
    expect(bad.passed).toBe(false);
    expect(bad.message).toContain('Property "active" expected a boolean');
  });

  it("declared type without value present passes (type does not imply required)", () => {
    const r = evalSchema(
      { type: "object", properties: { name: { type: "string" } } },
      JSON.stringify({ other: 1 })
    );
    expect(r.passed).toBe(true);
  });

  it("const/enum continue to work alongside type", () => {
    const schema = {
      type: "object",
      required: ["category"],
      properties: {
        category: { type: "string", enum: ["billing", "technical"] },
        code: { type: "integer", const: 503 },
      },
    };

    const ok = evalSchema(
      schema,
      JSON.stringify({ category: "billing", code: 503 })
    );
    expect(ok.passed).toBe(true);

    const badEnum = evalSchema(
      schema,
      JSON.stringify({ category: "other", code: 503 })
    );
    expect(badEnum.passed).toBe(false);
    expect(badEnum.message).toContain("not in enum");

    const badConst = evalSchema(
      schema,
      JSON.stringify({ category: "billing", code: 504 })
    );
    expect(badConst.passed).toBe(false);
    expect(badConst.message).toContain("expected const 503");
  });
});

describe("json_schema property type load-time validation (fail fast, exit 2)", () => {
  it("rejects unsupported property type at load", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: {
          type: "object",
          properties: { x: { type: "date" } },
        },
      })
    ).toThrow(/unsupported type "date"/i);
  });

  it("rejects unsupported nested property type at load", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            user: {
              type: "object",
              properties: { name: { type: "symbol" } },
            },
          },
        },
      })
    ).toThrow(/unsupported type "symbol"/i);
  });

  it("rejects non-string property type at load", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: {
          type: "object",
          properties: { x: { type: 42 } },
        },
      })
    ).toThrow(/unsupported type 42/i);
  });

  it("rejects malformed nested properties at load", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            user: { type: "object", properties: "nope" },
          },
        },
      })
    ).toThrow(/".*properties" must be an object/i);
  });

  it("accepts supported property types at load", () => {
    const a = parseAssertion({
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          s: { type: "string" },
          n: { type: "number" },
          i: { type: "integer" },
          b: { type: "boolean" },
          o: { type: "object", properties: { k: { type: "string" } } },
          ar: { type: "array", items: { type: "integer" } },
          nil: { type: "null" },
        },
      },
    });
    expect(a.type).toBe("json_schema");
  });
});
