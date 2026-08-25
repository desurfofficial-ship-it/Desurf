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

  it("rejects unknown assertion type", () => {
    expect(() =>
      parseAssertion({ type: "contains", value: "x" } as never)
    ).toThrow(/Unknown assertion type/i);
  });
});
