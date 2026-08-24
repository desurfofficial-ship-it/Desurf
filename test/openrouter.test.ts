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

    expect(out).toEqual({ text: "DESURF_OK" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.messages[0].role).toBe("user");
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

  it("HTTP error", async () => {
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
