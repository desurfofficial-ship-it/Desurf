/**
 * OpenRouter live provider.
 * Implements ModelAdapter. All HTTP and response parsing stay here.
 * Does not log or expose API credentials.
 */

import type { ExecuteRequest, GenerationParams, ModelAdapter, ModelOutput } from "./types.js";
import {
  fetchWithRetries,
  normalizeMaxTokens,
  normalizeSeed,
  normalizeTemperature,
  resolveMaxRetries,
  resolveTimeoutMs,
} from "./provider-utils.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterAdapterOptions = GenerationParams & {
  /** @deprecated use {@link GenerationParams.timeoutMs} — kept for source compat */
  baseUrl?: string;
};

type ChatCompletionsBody = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
};

/** Minimal response shape (avoids depending on DOM Response typings). */
type HttpResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

/** Strip API key from any error text so it never appears in CLI/output. */
function redactSecrets(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join("[redacted]");
}

export class OpenRouterAdapter implements ModelAdapter {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number | undefined;
  private readonly seed: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly systemPrompt: string | undefined;

  constructor(options: OpenRouterAdapterOptions = {}) {
    const key = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.apiKey = key.trim();
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (
      options.baseUrl ??
      process.env.OPENROUTER_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.maxRetries = resolveMaxRetries(options.maxRetries);
    // normalizeTemperature defaults to 0 (deterministic) when omitted, so
    // recorded cassettes are reproducible. Throws on out-of-range input.
    this.temperature = normalizeTemperature(options.temperature);
    this.seed = normalizeSeed(options.seed);
    this.maxTokens = normalizeMaxTokens(options.maxTokens);
    this.systemPrompt = options.systemPrompt?.trim() || undefined;
  }

  async execute(request: ExecuteRequest): Promise<ModelOutput> {
    if (!this.apiKey) {
      throw new Error(
        "OpenRouterAdapter: missing API key. Set OPENROUTER_API_KEY in the environment."
      );
    }

    if (typeof this.fetchFn !== "function") {
      throw new Error(
        "OpenRouterAdapter: fetch is not available in this runtime."
      );
    }

    const selectedModel = request.model ?? this.model;
    // Live path ignores outputPath; input + prompt form the user message.
    const userContent = [request.prompt.trim(), request.input.trim()]
      .filter(Boolean)
      .join("\n\n");

    // Request-level overrides win over constructor-level.
    const temperature =
      request.temperature !== undefined
        ? normalizeTemperature(request.temperature)
        : this.temperature;
    const seed =
      request.seed !== undefined ? normalizeSeed(request.seed) : this.seed;
    const maxTokens =
      request.maxTokens !== undefined
        ? normalizeMaxTokens(request.maxTokens)
        : this.maxTokens;
    const systemPrompt =
      request.systemPrompt?.trim() || this.systemPrompt;

    // Build the messages array. system role first (if provided), then user.
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userContent });

    const reqBody: Record<string, unknown> = {
      model: selectedModel,
      messages,
      // Default temperature 0 = deterministic sampling. This is the single
      // most important determinism knob: without it, `desurf record --force`
      // against the same prompt could produce a different output and the
      // next `desurf test` would flag a spurious regression.
      temperature,
    };
    if (seed !== undefined) {
      reqBody.seed = seed;
    }
    if (maxTokens !== undefined) {
      reqBody.max_tokens = maxTokens;
    }

    const url = `${this.baseUrl}/chat/completions`;
    const response: HttpResponse = (await fetchWithRetries(
      this.fetchFn,
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
      },
      this.timeoutMs,
      this.maxRetries,
      (s) => redactSecrets(s, this.apiKey)
    )) as unknown as HttpResponse;

    const rawText = await response.text();
    if (!response.ok) {
      let detail = rawText.slice(0, 200);
      try {
        const parsed = JSON.parse(rawText) as ChatCompletionsBody;
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep truncated raw body
      }
      throw new Error(
        `OpenRouterAdapter: HTTP ${response.status}: ${redactSecrets(detail, this.apiKey)}`
      );
    }

    let body: ChatCompletionsBody;
    try {
      body = JSON.parse(rawText) as ChatCompletionsBody;
    } catch {
      throw new Error("OpenRouterAdapter: response was not valid JSON");
    }

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(
        "OpenRouterAdapter: empty or missing message content in response"
      );
    }

    return {
      text,
      provider: "openrouter",
      model: selectedModel,
    };
  }
}
