/**
 * GeminiAdapter unit tests — mocked HTTP only. No live API key required.
 */

import { describe, it, expect, vi } from "vitest";
import { GeminiAdapter } from "../src/gemini.js";
import { createProvider } from "../src/create-provider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GeminiAdapter", () => {
  it("successful response → { text, provider, model }", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        candidates: [
          {
            content: {
              parts: [{ text: "DESURF_GEMINI_OK" }],
            },
          },
        ],
      })
    );

    const adapter = new GeminiAdapter({
      apiKey: "test-gemini-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await adapter.execute({
      input: "input data",
      prompt: "prompt text",
    });

    expect(out).toEqual({
      text: "DESURF_GEMINI_OK",
      provider: "gemini",
      model: "gemini-2.0-flash",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
    expect(String(url)).toContain("key=test-gemini-key");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[0].parts[0].text).toContain("prompt text");
    expect(body.contents[0].parts[0].text).toContain("input data");
    expect(init?.signal).toBeDefined();
  });

  it("accepts GOOGLE_API_KEY environment variable as fallback", async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevGoogle = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "fallback-google-key";

    try {
      const fetchMock = vi.fn(async () =>
        jsonResponse(200, {
          candidates: [{ content: { parts: [{ text: "ok" }] } }],
        })
      );
      const adapter = new GeminiAdapter({
        fetch: fetchMock as unknown as typeof fetch,
      });
      await adapter.execute({ input: "a", prompt: "b" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("key=fallback-google-key");
    } finally {
      if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
      if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
      else delete process.env.GOOGLE_API_KEY;
    }
  });

  it("custom model override via request or constructor", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "pro-response" }] } }],
      })
    );

    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      model: "gemini-1.5-pro",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await adapter.execute({
      input: "x",
      prompt: "y",
      model: "gemini-1.5-flash-8b",
    });

    expect(out.model).toBe("gemini-1.5-flash-8b");
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-1.5-flash-8b:generateContent");
  });

  it("missing API key throws clear error", async () => {
    const prevGemini = process.env.GEMINI_API_KEY;
    const prevGoogle = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      const adapter = new GeminiAdapter({
        apiKey: "",
        fetch: vi.fn() as unknown as typeof fetch,
      });
      await expect(
        adapter.execute({ input: "x", prompt: "y" })
      ).rejects.toThrow(/missing API key\. Set GEMINI_API_KEY/i);
    } finally {
      if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
      if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
    }
  });

  it("HTTP 400 returns clean error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, { error: { message: "Invalid argument" } })
    );
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 400: Invalid argument/);
  });

  it("HTTP 403 returns permission error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(403, { error: { message: "API key not valid" } })
    );
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 403: API key not valid/);
  });

  it("malformed response (not JSON)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("upstream-error-text", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
    );
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/not valid JSON/i);
  });

  it("empty message content", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { candidates: [{ content: { parts: [] } }] })
    );
    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/empty or missing message content/i);
  });

  it("error messages never include the API key", async () => {
    const secret = "AIzaSySecretGeminiKey12345";
    const fetchMock = vi.fn(async () => {
      throw new Error(`gemini call failed with key ${secret}`);
    });
    const adapter = new GeminiAdapter({
      apiKey: secret,
      fetch: fetchMock as unknown as typeof fetch,
    });
    try {
      await adapter.execute({ input: "x", prompt: "y" });
      expect.fail("expected throw");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toMatch(/network error/i);
      expect(msg).not.toContain(secret);
      expect(msg).toContain("[redacted]");
    }
  });

  it("timeout becomes a clean provider error", async () => {
    const abortFetch = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const timeoutAdapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: abortFetch as unknown as typeof fetch,
    });
    await expect(
      timeoutAdapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/timed out after 30000ms/i);
  });

  it("createProvider correctly constructs GeminiAdapter with aliases", () => {
    const adapter1 = createProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "custom-key",
    });
    expect(adapter1).toBeInstanceOf(GeminiAdapter);

    const adapter2 = createProvider({
      provider: "google",
      model: "gemini-1.5-pro",
      apiKey: "custom-key",
    });
    expect(adapter2).toBeInstanceOf(GeminiAdapter);
  });

  it("passes systemPrompt, maxTokens, and temperature into Gemini request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      })
    );

    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
      temperature: 0.2,
      maxTokens: 500,
      systemPrompt: "System instruction test",
    });

    await adapter.execute({ input: "a", prompt: "b" });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.generationConfig.temperature).toBe(0.2);
    expect(body.generationConfig.maxOutputTokens).toBe(500);
    expect(body.systemInstruction).toEqual({
      parts: [{ text: "System instruction test" }],
    });
  });

  it("retries on transient 503 then succeeds", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse(503, { error: { message: "Service unavailable" } });
      }
      return jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "gemini recovered" }] } }],
      });
    });

    const adapter = new GeminiAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 2,
    });

    const out = await adapter.execute({ input: "x", prompt: "y" });
    expect(out.text).toBe("gemini recovered");
    expect(callCount).toBe(2);
  });
});
