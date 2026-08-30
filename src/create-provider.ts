/**
 * Provider selection factory.
 * Keeps CLI free of provider-specific construction details beyond flags.
 */

import { AnthropicAdapter } from "./anthropic.js";
import { GeminiAdapter } from "./gemini.js";
import { OpenAIAdapter } from "./openai.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { SavedOutputAdapter } from "./provider.js";
import type { ModelAdapter } from "./types.js";

export type ProviderName =
  | "offline"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "google";

export type CreateProviderOptions = {
  /** Provider id from CLI. Default offline. */
  provider?: string;
  /** Optional model id (used by live providers). */
  model?: string;
  /** Optional API key override (primarily for programmatic tests). */
  apiKey?: string;
  /** Optional custom fetch (primarily for unit tests). */
  fetch?: typeof globalThis.fetch;
};

/**
 * Build a ModelAdapter from CLI-facing options.
 * Unknown provider names throw (configuration error → exit 2 at CLI).
 */
export function createProvider(options: CreateProviderOptions = {}): ModelAdapter {
  const name = (options.provider ?? "offline").toLowerCase();

  if (name === "offline" || name === "saved" || name === "saved-output") {
    return new SavedOutputAdapter();
  }

  if (name === "openrouter") {
    return new OpenRouterAdapter({
      model: options.model,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
  }

  if (name === "openai") {
    return new OpenAIAdapter({
      model: options.model,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
  }

  if (name === "anthropic") {
    return new AnthropicAdapter({
      model: options.model,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
  }

  if (name === "gemini" || name === "google") {
    return new GeminiAdapter({
      model: options.model,
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
  }

  throw new Error(
    `Unknown provider: "${options.provider}". Supported: offline, openrouter, openai, anthropic, gemini`
  );
}
