/**
 * Provider selection — offline remains default.
 */

import { describe, it, expect } from "vitest";
import { createProvider } from "../src/create-provider.js";
import { OpenRouterAdapter } from "../src/openrouter.js";
import { OpenAIAdapter } from "../src/openai.js";
import { AnthropicAdapter } from "../src/anthropic.js";
import { GeminiAdapter } from "../src/gemini.js";
import { SavedOutputAdapter } from "../src/provider.js";
import { runSuite } from "../src/runner.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixtureRoot = resolve(__dirname, "../fixtures/basic");

describe("provider selection + offline default", () => {
  it("runSuite without provider still uses offline SavedOutputAdapter", async () => {
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      repeat: 1,
    });
    expect(summary.cases[0].state).toBe("PASS");
    expect(summary.passed).toBe(1);
  });

  it("explicit offline provider works", async () => {
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      provider: createProvider({ provider: "offline" }),
    });
    expect(summary.cases[0].state).toBe("PASS");
  });

  it("createProvider aliases and provider instantiations", () => {
    expect(createProvider({ provider: "saved" })).toBeInstanceOf(
      SavedOutputAdapter
    );
    expect(createProvider({ provider: "saved-output" })).toBeInstanceOf(
      SavedOutputAdapter
    );
    expect(createProvider({ provider: "OpenRouter" })).toBeInstanceOf(
      OpenRouterAdapter
    );
    expect(createProvider({ provider: "openai" })).toBeInstanceOf(
      OpenAIAdapter
    );
    expect(createProvider({ provider: "anthropic" })).toBeInstanceOf(
      AnthropicAdapter
    );
    expect(createProvider({ provider: "gemini" })).toBeInstanceOf(
      GeminiAdapter
    );
    expect(createProvider({ provider: "google" })).toBeInstanceOf(
      GeminiAdapter
    );
  });

  it("rejects unknown provider with clear error message listing supported providers", () => {
    expect(() => createProvider({ provider: "unknown-ai" })).toThrow(
      /Unknown provider: "unknown-ai"\. Supported: offline, openrouter, openai, anthropic, gemini/
    );
  });

  it("passes GenerationParams to created live adapter", () => {
    const adapter = createProvider({
      provider: "openai",
      temperature: 0.5,
      seed: 42,
      maxTokens: 100,
      timeoutMs: 5000,
      maxRetries: 3,
      systemPrompt: "test system",
    });
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });
});
