/**
 * Provider selection factory.
 * Keeps CLI free of provider-specific construction details beyond flags.
 */

import { AnthropicAdapter } from "./anthropic.js";
import { GeminiAdapter } from "./gemini.js";
import { OpenAIAdapter } from "./openai.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { SavedOutputAdapter } from "./provider.js";
import type { GenerationParams, ModelAdapter } from "./types.js";

export type ProviderName =
  | "offline"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "google";

export type CreateProviderOptions = GenerationParams & {
  /** Provider id from CLI. Default offline. */
  provider?: string;
};

/**
 * Build a ModelAdapter from CLI-facing options.
 * Unknown provider names throw (configuration error → exit 2 at CLI).
 *
 * Generation parameters (temperature, seed, maxTokens, timeoutMs, maxRetries,
 * systemPrompt) are passed through to live providers and ignored by the
 * offline adapter. This keeps a single, well-typed seam between the CLI
 * and every provider — no per-adapter flag plumbing in cli.ts.
 */
export function createProvider(options: CreateProviderOptions = {}): ModelAdapter {
  const name = (options.provider ?? "offline").toLowerCase();

  if (name === "offline" || name === "saved" || name === "saved-output") {
    return new SavedOutputAdapter();
  }

  // Strip the provider id; pass the rest as shared generation params.
  const { provider: _provider, ...gen } = options;

  if (name === "openrouter") {
    return new OpenRouterAdapter(gen);
  }

  if (name === "openai") {
    return new OpenAIAdapter(gen);
  }

  if (name === "anthropic") {
    return new AnthropicAdapter(gen);
  }

  if (name === "gemini" || name === "google") {
    return new GeminiAdapter(gen);
  }

  throw new Error(
    `Unknown provider: "${options.provider}". Supported: offline, openrouter, openai, anthropic, gemini`
  );
}
