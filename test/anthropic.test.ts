/**
 * AnthropicAdapter unit tests — mocked HTTP only. No live API key required.
 */

import { describe, it, expect, vi } from "vitest";
import { AnthropicAdapter } from "../src/anthropic.js";
import { createProvider } from "../src/create-provider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AnthropicAdapter", () => {
  it("successful response → { text, provider, model }", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        content: [{ type: "text", text: "DESURF_ANTHROPIC_OK" }],
      })
    );

    const adapter = new AnthropicAdapter({
      apiKey: "test-anthropic-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await adapter.execute({
      input: "input data",
      prompt: "prompt text",
    });

    expect(out).toEqual({
      text: "DESURF_ANTHROPIC_OK",
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-anthropic-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("claude-3-5-haiku-20241022");
    expect(body.max_tokens).toBe(4096);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain("prompt text");
    expect(body.messages[0].content).toContain("input data");
    expect(init?.signal).toBeDefined();
  });

  it("custom model override via request or constructor", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        content: [{ type: "text", text: "claude-3-5-sonnet-response" }],
      })
    );

    const adapter = new AnthropicAdapter({
      apiKey: "test-key",
      model: "claude-3-5-sonnet-20241022",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await adapter.execute({
      input: "x",
      prompt: "y",
      model: "claude-3-opus-20240229",
    });

    expect(out.model).toBe("claude-3-opus-20240229");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("claude-3-opus-20240229");
  });

  it("missing API key throws clear error", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const adapter = new AnthropicAdapter({
        apiKey: "",
        fetch: vi.fn() as unknown as typeof fetch,
      });
      await expect(
        adapter.execute({ input: "x", prompt: "y" })
      ).rejects.toThrow(/missing API key\. Set ANTHROPIC_API_KEY/i);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("HTTP 401 returns clean error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { error: { message: "Invalid x-api-key" } })
    );
    const adapter = new AnthropicAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 401: Invalid x-api-key/);
  });

  it("HTTP 429 returns rate limit error", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { error: { message: "Too many requests" } })
    );
    const adapter = new AnthropicAdapter({
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
    const adapter = new AnthropicAdapter({
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
        new Response("upstream-error-text", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
    );
    const adapter = new AnthropicAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/not valid JSON/i);
  });

  it("empty message content", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { content: [] })
    );
    const adapter = new AnthropicAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/empty or missing message content/i);
  });

  it("error messages never include the API key", async () => {
    const secret = "sk-ant-super-secret-key-9999";
    const fetchMock = vi.fn(async () => {
      throw new Error(`anthropic failure with key ${secret}`);
    });
    const adapter = new AnthropicAdapter({
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
    const timeoutAdapter = new AnthropicAdapter({
      apiKey: "test-key",
      fetch: abortFetch as unknown as typeof fetch,
    });
    await expect(
      timeoutAdapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/timed out after 30000ms/i);
  });

  it("createProvider correctly constructs AnthropicAdapter", () => {
    const adapter = createProvider({
      provider: "anthropic",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "custom-key",
    });
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
  });
});
