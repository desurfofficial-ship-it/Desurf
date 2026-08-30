/**
 * OpenAIAdapter unit tests — mocked HTTP only. No live API key required.
 */

import { describe, it, expect, vi } from "vitest";
import { OpenAIAdapter } from "../src/openai.js";
import { createProvider } from "../src/create-provider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAIAdapter", () => {
  it("successful response → { text, provider, model }", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "DESURF_OPENAI_OK" } }],
      })
    );

    const adapter = new OpenAIAdapter({
      apiKey: "test-openai-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await adapter.execute({
      input: "input data",
      prompt: "prompt text",
    });

    expect(out).toEqual({
      text: "DESURF_OPENAI_OK",
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-openai-key");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("prompt text");
    expect(body.messages[0].content).toContain("input data");
    expect(init?.signal).toBeDefined();
  });

  it("custom model override via request or constructor", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "gpt4-response" } }],
      })
    );

    const adapter = new OpenAIAdapter({
      apiKey: "test-key",
      model: "gpt-4o",
      fetch: fetchMock as unknown as typeof fetch,
    });

    // Request-level model override
    const out = await adapter.execute({
      input: "x",
      prompt: "y",
      model: "gpt-4-turbo",
    });

    expect(out.model).toBe("gpt-4-turbo");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("gpt-4-turbo");
  });

  it("missing API key throws clear error", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const adapter = new OpenAIAdapter({
        apiKey: "",
        fetch: vi.fn() as unknown as typeof fetch,
      });
      await expect(
        adapter.execute({ input: "x", prompt: "y" })
      ).rejects.toThrow(/missing API key\. Set OPENAI_API_KEY/i);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("HTTP 401 returns clean error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { error: { message: "Invalid API key" } })
    );
    const adapter = new OpenAIAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 401: Invalid API key/);
  });

  it("HTTP 429 returns rate limit error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { error: { message: "Rate limit exceeded" } })
    );
    const adapter = new OpenAIAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 429/);
  });

  it("HTTP 500 returns server error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(500, { error: { message: "Internal server error" } })
    );
    const adapter = new OpenAIAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 500/);
  });

  it("malformed response (not JSON)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("bad-gateway-html", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
    );
    const adapter = new OpenAIAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/not valid JSON/i);
  });

  it("empty message content", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: "" } }] })
    );
    const adapter = new OpenAIAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/empty or missing message content/i);
  });

  it("error messages never include the API key", async () => {
    const secret = "sk-openai-super-secret-key-12345";
    const fetchMock = vi.fn(async () => {
      throw new Error(`fetch failed with ${secret}`);
    });
    const adapter = new OpenAIAdapter({
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
    const timeoutAdapter = new OpenAIAdapter({
      apiKey: "test-key",
      fetch: abortFetch as unknown as typeof fetch,
    });
    await expect(
      timeoutAdapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/timed out after 30000ms/i);
  });

  it("createProvider correctly constructs OpenAIAdapter", () => {
    const adapter = createProvider({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "custom-key",
    });
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });
});
