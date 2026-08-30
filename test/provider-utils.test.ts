import { describe, it, expect, vi } from "vitest";
import {
  fetchWithRetries,
  normalizeMaxTokens,
  normalizeSeed,
  normalizeTemperature,
  resolveMaxRetries,
  resolveTimeoutMs,
} from "../src/provider-utils.js";

describe("provider-utils", () => {
  describe("normalizeTemperature", () => {
    it("returns default 0 when undefined", () => {
      expect(normalizeTemperature(undefined)).toBe(0);
    });

    it("accepts valid temperatures between 0 and 2", () => {
      expect(normalizeTemperature(0)).toBe(0);
      expect(normalizeTemperature(1)).toBe(1);
      expect(normalizeTemperature(2)).toBe(2);
      expect(normalizeTemperature(0.7)).toBe(0.7);
    });

    it("throws on NaN or out of range temperature", () => {
      expect(() => normalizeTemperature(NaN)).toThrow(/between 0 and 2/);
      expect(() => normalizeTemperature(-0.1)).toThrow(/between 0 and 2/);
      expect(() => normalizeTemperature(2.1)).toThrow(/between 0 and 2/);
    });
  });

  describe("normalizeSeed", () => {
    it("returns undefined for undefined", () => {
      expect(normalizeSeed(undefined)).toBeUndefined();
    });

    it("accepts non-negative integers", () => {
      expect(normalizeSeed(0)).toBe(0);
      expect(normalizeSeed(42)).toBe(42);
    });

    it("throws on negative or non-integer", () => {
      expect(() => normalizeSeed(-1)).toThrow(/non-negative integer/);
      expect(() => normalizeSeed(1.5)).toThrow(/non-negative integer/);
    });
  });

  describe("normalizeMaxTokens", () => {
    it("returns undefined for undefined", () => {
      expect(normalizeMaxTokens(undefined)).toBeUndefined();
    });

    it("accepts positive integers", () => {
      expect(normalizeMaxTokens(1)).toBe(1);
      expect(normalizeMaxTokens(4096)).toBe(4096);
    });

    it("throws on non-positive integers", () => {
      expect(() => normalizeMaxTokens(0)).toThrow(/positive integer/);
      expect(() => normalizeMaxTokens(-10)).toThrow(/positive integer/);
      expect(() => normalizeMaxTokens(1.5)).toThrow(/positive integer/);
    });
  });

  describe("resolveTimeoutMs", () => {
    it("returns explicit timeout if valid", () => {
      expect(resolveTimeoutMs(5000)).toBe(5000);
    });

    it("falls back to default 30000", () => {
      expect(resolveTimeoutMs(undefined)).toBe(30_000);
    });

    it("throws if out of bounds", () => {
      expect(() => resolveTimeoutMs(500)).toThrow(/between 1000 and 600000/);
      expect(() => resolveTimeoutMs(700_000)).toThrow(/between 1000 and 600000/);
    });
  });

  describe("resolveMaxRetries", () => {
    it("returns explicit retries if valid", () => {
      expect(resolveMaxRetries(3)).toBe(3);
    });

    it("falls back to default 0", () => {
      expect(resolveMaxRetries(undefined)).toBe(0);
    });

    it("throws if out of bounds", () => {
      expect(() => resolveMaxRetries(-1)).toThrow(/between 0 and 5/);
      expect(() => resolveMaxRetries(6)).toThrow(/between 0 and 5/);
    });
  });

  describe("fetchWithRetries", () => {
    it("does not retry on 400 client error", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: "bad request" }), { status: 400 })
      );

      const resp = await fetchWithRetries(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        { method: "POST" },
        5000,
        3
      );
      expect(resp.status).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries on 500 up to maxRetries then returns response", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ error: "server error" }), { status: 500 })
      );

      const resp = await fetchWithRetries(
        fetchMock as unknown as typeof fetch,
        "https://example.com",
        { method: "POST" },
        5000,
        2
      );
      expect(resp.status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });
});
