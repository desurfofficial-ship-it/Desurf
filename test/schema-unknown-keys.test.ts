import { describe, it, expect } from "vitest";
import { parseAssertion } from "../src/offline.js";
import { evaluateAssertion } from "../src/assertions.js";
import type { ModelOutput } from "../src/types.js";
const empty: ModelOutput = { text: "{}" };
describe("json_schema unknown-key rejection (P0)", () => {
  it("valid minimal", () => { expect(parseAssertion({ type: "json_schema", schema: { type: "object" } }).type).toBe("json_schema"); });
  it("valid required", () => { expect(parseAssertion({ type: "json_schema", schema: { type: "object", required: ["a"] } }).type).toBe("json_schema"); });
  it("reject requried", () => { expect(() => parseAssertion({ type: "json_schema", schema: { type: "object", requried: ["a"] } } as never)).toThrow(/unknown keyword/i); });
  it("reject additionalProperties", () => { expect(() => parseAssertion({ type: "json_schema", schema: { type: "object", additionalProperties: false } } as never)).toThrow(/additionalProperties/); });
  it("reject nested minLength", () => { expect(() => parseAssertion({ type: "json_schema", schema: { type: "object", properties: { n: { type: "string", minLength: 1 } } } } as never)).toThrow(/minLength/); });
  it("reject deep pattern", () => { expect(() => parseAssertion({ type: "json_schema", schema: { type: "object", properties: { a: { type: "object", properties: { b: { type: "string", pattern: "x" } } } } } } as never)).toThrow(/pattern/); });
  it("valid required fails on {}", () => { expect(evaluateAssertion(parseAssertion({ type: "json_schema", schema: { type: "object", required: ["answer"] } }), empty).passed).toBe(false); });
});
