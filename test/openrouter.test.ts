/**
 * OpenRouterAdapter unit tests — mocked HTTP only. No live API key required.
 */

import { describe, it, expect, vi } from "vitest";
import { OpenRouterAdapter } from "../src/openrouter.js";
import { createProvider } from "../src/create-provider.js";
import { SavedOutputAdapter } from "../src/provider.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenRouterAdapter", () => {
  it("successful response → { text }", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "DESURF_OK" } }],
      })
    );

    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const out = await adapter.execute({
      input: "hello",
      prompt: "Reply with exactly: DESURF_OK",
    });

    expect(out).toEqual({
      text: "DESURF_OK",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.messages[0].role).toBe("user");
    // Timeout signal is attached (Node 18+ AbortSignal.timeout)
    expect(init?.signal).toBeDefined();
  });

  it("missing API key", async () => {
    const prev = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const adapter = new OpenRouterAdapter({
        apiKey: "",
        fetch: vi.fn() as unknown as typeof fetch,
      });
      await expect(
        adapter.execute({ input: "x", prompt: "y" })
      ).rejects.toThrow(/missing API key/i);
    } finally {
      if (prev !== undefined) process.env.OPENROUTER_API_KEY = prev;
    }
  });

  it("HTTP 401", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(401, { error: { message: "Unauthorized" } })
    );
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 401/);
  });

  it("HTTP 429", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { error: { message: "Rate limit exceeded" } })
    );
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/HTTP 429/);
  });

  it("HTTP 500", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(500, { error: { message: "Internal server error" } })
    );
    const adapter = new OpenRouterAdapter({
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
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
    );
    const adapter = new OpenRouterAdapter({
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
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/empty or missing message content/i);
  });

  it("error messages never include the API key", async () => {
    const secret = "sk-super-secret-key-value-xyz";
    const fetchMock = vi.fn(async () => {
      throw new Error(`upstream failed involving ${secret}`);
    });
    const adapter = new OpenRouterAdapter({
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
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
    });

    // Use a real short timeout by relying on AbortSignal.timeout in adapter;
    // mock never resolves until aborted — but adapter uses 30s timeout.
    // Instead simulate AbortError from fetch immediately via pre-aborted behavior:
    const abortFetch = vi.fn(async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    });
    const timeoutAdapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: abortFetch as unknown as typeof fetch,
    });
    await expect(
      timeoutAdapter.execute({ input: "x", prompt: "y" })
    ).rejects.toThrow(/timed out after 30000ms/i);
  });

  it("custom model option is sent in body", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "ok" } }],
      })
    );
    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      model: "openai/gpt-4o-mini",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await adapter.execute({ input: "a", prompt: "b" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("openai/gpt-4o-mini");
  });

  it("passes systemPrompt, seed, maxTokens, and temperature", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        choices: [{ message: { content: "ok" } }],
      })
    );

    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
      temperature: 0.7,
      seed: 123,
      maxTokens: 250,
      systemPrompt: "System instruction for OpenRouter",
    });

    await adapter.execute({ input: "a", prompt: "b" });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.temperature).toBe(0.7);
    expect(body.seed).toBe(123);
    expect(body.max_tokens).toBe(250);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "System instruction for OpenRouter",
    });
    expect(body.messages[1].role).toBe("user");
  });

  it("retries on transient 429 then succeeds", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse(429, { error: { message: "Rate limit exceeded" } });
      }
      return jsonResponse(200, {
        choices: [{ message: { content: "openrouter recovered" } }],
      });
    });

    const adapter = new OpenRouterAdapter({
      apiKey: "test-key",
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 2,
    });

    const out = await adapter.execute({ input: "x", prompt: "y" });
    expect(out.text).toBe("openrouter recovered");
    expect(callCount).toBe(2);
  });
});

describe("createProvider", () => {
  it("default / offline → SavedOutputAdapter", () => {
    expect(createProvider()).toBeInstanceOf(SavedOutputAdapter);
    expect(createProvider({ provider: "offline" })).toBeInstanceOf(
      SavedOutputAdapter
    );
  });

  it("openrouter → OpenRouterAdapter", () => {
    expect(createProvider({ provider: "openrouter" })).toBeInstanceOf(
      OpenRouterAdapter
    );
  });

  it("unknown provider throws", () => {
    expect(() => createProvider({ provider: "nope" })).toThrow(/Unknown provider/);
  });
});
