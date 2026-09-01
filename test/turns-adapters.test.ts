/** B3 M2 — history accumulation + live adapter message shapes (T7–T9). */
import { describe, it, expect, vi } from "vitest";
import { OpenAIAdapter } from "../src/openai.js";
import { AnthropicAdapter } from "../src/anthropic.js";
import { GeminiAdapter } from "../src/gemini.js";
import { OpenRouterAdapter } from "../src/openrouter.js";
import type { ExecuteRequest, ModelAdapter, ModelOutput } from "../src/types.js";
import { runSuite } from "../src/runner.js";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCassetteMeta } from "../src/fingerprint.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** MockProvider that records execute requests for T7. */
class RecordingMock implements ModelAdapter {
  readonly name = "mock";
  calls: ExecuteRequest[] = [];
  async execute(req: ExecuteRequest): Promise<ModelOutput> {
    this.calls.push(structuredClone(req));
    return { text: `a${this.calls.length - 1}` };
  }
}

describe("T7 runner history accumulation", () => {
  it("turn 2 receives history = [u0, a0, u1]", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t7-"));
    try {
      await mkdir(join(dir, "inputs"), { recursive: true });
      await mkdir(join(dir, "prompts"), { recursive: true });
      await mkdir(join(dir, "outputs"), { recursive: true });
      await writeFile(join(dir, "prompts", "sys.txt"), "SYS\n", "utf8");
      await writeFile(join(dir, "inputs", "t0.txt"), "u0-content", "utf8");
      await writeFile(join(dir, "inputs", "t1.txt"), "u1-content", "utf8");
      await writeFile(join(dir, "inputs", "t2.txt"), "u2-content", "utf8");
      // Live path — no transcript needed for mock provider
      await writeFile(
        join(dir, "suite.json"),
        JSON.stringify({
          name: "t7",
          cases: [
            {
              id: "chat",
              prompt: "prompts/sys.txt",
              output: "outputs/chat.json",
              turns: [
                { user: "inputs/t0.txt" },
                { user: "inputs/t1.txt" },
                { user: "inputs/t2.txt" },
              ],
              assertions: [{ type: "required", value: "a" }],
            },
          ],
        }),
        "utf8"
      );
      const mock = new RecordingMock();
      const summary = await runSuite({ suitePath: dir, provider: mock });
      expect(summary.errors).toBe(0);
      expect(mock.calls).toHaveLength(3);
      // Turn 0: no history
      expect(mock.calls[0]!.history).toBeUndefined();
      expect(mock.calls[0]!.input).toBe("u0-content");
      // Turn 1: [u0, a0]
      expect(mock.calls[1]!.history).toEqual([
        { role: "user", content: "u0-content" },
        { role: "assistant", content: "a0" },
      ]);
      // Turn 2: [u0, a0, u1, a1]
      expect(mock.calls[2]!.history).toEqual([
        { role: "user", content: "u0-content" },
        { role: "assistant", content: "a0" },
        { role: "user", content: "u1-content" },
        { role: "assistant", content: "a1" },
      ]);
      expect(mock.calls[2]!.input).toBe("u2-content");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("T8/T9 live adapters history shape", () => {
  const history = [
    { role: "user" as const, content: "u0" },
    { role: "assistant" as const, content: "a0" },
    { role: "user" as const, content: "u1" },
    { role: "assistant" as const, content: "a1" },
  ];

  it("T8 openai: system + history + final user", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: "ok" } }] })
    );
    const adapter = new OpenAIAdapter({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await adapter.execute({
      input: "u2",
      prompt: "SYS",
      history,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages[1]).toEqual({ role: "user", content: "u0" });
    expect(body.messages[2]).toEqual({ role: "assistant", content: "a0" });
    expect(body.messages[3]).toEqual({ role: "user", content: "u1" });
    expect(body.messages[4]).toEqual({ role: "assistant", content: "a1" });
    expect(body.messages[5]).toEqual({ role: "user", content: "u2" });
    // Final user is input only — prompt is system, not joined
    expect(body.messages[5].content).not.toContain("SYS");
  });

  it("T9 anthropic: system top-level + alternating messages", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { content: [{ type: "text", text: "ok" }] })
    );
    const adapter = new AnthropicAdapter({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await adapter.execute({ input: "u2", prompt: "SYS", history });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.system).toBe("SYS");
    expect(body.messages[0]).toEqual({ role: "user", content: "u0" });
    expect(body.messages[1]).toEqual({ role: "assistant", content: "a0" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "u2" });
  });

  it("T9 gemini: contents user/model mapping", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
      })
    );
    const adapter = new GeminiAdapter({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await adapter.execute({ input: "u2", prompt: "SYS", history });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "u0" }] });
    expect(body.contents[1]).toEqual({ role: "model", parts: [{ text: "a0" }] });
    expect(body.contents.at(-1)).toEqual({ role: "user", parts: [{ text: "u2" }] });
  });

  it("T9 openrouter: chat shape with history", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { choices: [{ message: { content: "ok" } }] })
    );
    const adapter = new OpenRouterAdapter({
      apiKey: "k",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await adapter.execute({ input: "u2", prompt: "SYS", history });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "u2" });
    expect(body.messages.length).toBe(6); // system + 4 history + final
  });
});
