import { describe, it, expect } from "vitest";
import { parseAssertion } from "../src/offline.js";

describe("assertion schema safety", () => {
  it("accepts valid forbidden with caseSensitive", () => {
    const a = parseAssertion({
      type: "forbidden",
      value: "as an AI",
      caseSensitive: false,
    });
    expect(a.type).toBe("forbidden");
  });

  it("rejects unknown field on forbidden", () => {
    expect(() =>
      parseAssertion({
        type: "forbidden",
        value: "as an AI",
        someTypo: true,
      } as never)
    ).toThrow(/Unknown field/i);
  });

  it("rejects unknown field on required", () => {
    expect(() =>
      parseAssertion({
        type: "required",
        value: "x",
        typoField: 1,
      } as never)
    ).toThrow(/Unknown field/i);
  });

  it("rejects unknown field on regex", () => {
    expect(() =>
      parseAssertion({
        type: "regex",
        pattern: "a",
        ignoreCase: true,
      } as never)
    ).toThrow(/Unknown field/i);
  });

  it("rejects unknown field on json_schema", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: { type: "object" },
        strict: true,
      } as never)
    ).toThrow(/Unknown field/i);
  });

  it("rejects unknown assertion type", () => {
    expect(() =>
      parseAssertion({ type: "contains", value: "x" } as never)
    ).toThrow(/Unknown assertion type/i);
  });

  it("rejects empty string value on required assertion", () => {
    expect(() =>
      parseAssertion({ type: "required", value: "" })
    ).toThrow(/non-empty "value"/i);
  });

  it("rejects empty string value on forbidden assertion", () => {
    expect(() =>
      parseAssertion({ type: "forbidden", value: "" })
    ).toThrow(/non-empty "value"/i);
  });

  it("rejects invalid regex pattern at parse time", () => {
    expect(() =>
      parseAssertion({ type: "regex", pattern: "([" })
    ).toThrow(/invalid \/\(\[\//i);
  });

  it("rejects unsupported json_schema type", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: { type: "string" },
      })
    ).toThrow(/unsupported type "string"/i);
  });

  it("rejects non-array required in json_schema", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: { type: "object", required: "category" as never },
      })
    ).toThrow(/"required" must be an array of strings/i);
  });

  it("rejects object const in json_schema properties", () => {
    expect(() =>
      parseAssertion({
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            details: { const: { foo: "bar" } },
          },
        },
      })
    ).toThrow(/const must be a primitive/i);
  });
});
