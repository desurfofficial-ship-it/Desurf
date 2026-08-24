/**
 * Provider selection factory.
 * Keeps CLI free of OpenRouter-specific construction details beyond flags.
 */

import { OpenRouterAdapter } from "./openrouter.js";
import { SavedOutputAdapter } from "./provider.js";
import type { ModelAdapter } from "./types.js";

export type ProviderName = "offline" | "openrouter";

export type CreateProviderOptions = {
  /** Provider id from CLI. Default offline. */
  provider?: string;
  /** Optional model id (used by live providers). */
  model?: string;
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
    });
  }

  throw new Error(
    `Unknown provider: "${options.provider}". Supported: offline, openrouter`
  );
}
