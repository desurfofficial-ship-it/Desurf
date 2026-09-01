/**
 * Anthropic live provider.
 * Implements ModelAdapter. Native fetch only.
 * Does not log or expose API credentials.
 */

import type { ExecuteRequest, GenerationParams, ModelAdapter, ModelOutput } from "./types.js";
import {
  fetchWithRetries,
  normalizeMaxTokens,
  normalizeTemperature,
  resolveMaxRetries,
  resolveTimeoutMs,
  DEFAULT_MAX_TOKENS,
} from "./provider-utils.js";

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicAdapterOptions = GenerationParams & {
  /** @deprecated use {@link GenerationParams.timeoutMs} — kept for source compat */
  baseUrl?: string;
};

type MessagesResponseBody = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: { message?: string };
};

type HttpResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

function redactSecrets(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.split(apiKey).join("[redacted]");
}

export class AnthropicAdapter implements ModelAdapter {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number;
  private readonly systemPrompt: string | undefined;

  constructor(options: AnthropicAdapterOptions = {}) {
    const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.apiKey = key.trim();
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (
      options.baseUrl ??
      process.env.ANTHROPIC_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.maxRetries = resolveMaxRetries(options.maxRetries);
    this.temperature = normalizeTemperature(options.temperature);
    // Anthropic REQUIRES max_tokens — default it rather than omit.
    this.maxTokens = normalizeMaxTokens(options.maxTokens) ?? DEFAULT_MAX_TOKENS;
    this.systemPrompt = options.systemPrompt?.trim() || undefined;
  }

  async execute(request: ExecuteRequest): Promise<ModelOutput> {
    if (!this.apiKey) {
      throw new Error(
        "AnthropicAdapter: missing API key. Set ANTHROPIC_API_KEY in the environment."
      );
    }

    if (typeof this.fetchFn !== "function") {
      throw new Error(
        "AnthropicAdapter: fetch is not available in this runtime."
      );
    }

    const selectedModel = request.model ?? this.model;
    const hasHistory = Boolean(request.history && request.history.length > 0);
    const userContent = hasHistory
      ? request.input.trim()
      : [request.prompt.trim(), request.input.trim()].filter(Boolean).join("\n\n");

    const temperature =
      request.temperature !== undefined
        ? normalizeTemperature(request.temperature)
        : this.temperature;
    const maxTokens =
      request.maxTokens !== undefined
        ? normalizeMaxTokens(request.maxTokens) ?? this.maxTokens
        : this.maxTokens;
    const systemPrompt =
      request.systemPrompt?.trim() ||
      this.systemPrompt ||
      (hasHistory ? request.prompt.trim() || undefined : undefined);

    // Anthropic: system top-level; messages alternate user/assistant (D4).
    const messages: Array<{ role: string; content: string }> = [];
    if (hasHistory && request.history) {
      for (const h of request.history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: "user", content: userContent });
    const reqBody: Record<string, unknown> = {
      model: selectedModel,
      max_tokens: maxTokens,
      // Default temperature 0 = deterministic.
      temperature,
      messages,
    };
    if (systemPrompt) {
      reqBody.system = systemPrompt;
    }

    const url = `${this.baseUrl}/messages`;
    const response: HttpResponse = (await fetchWithRetries(
      this.fetchFn,
      url,
      {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
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
        const parsed = JSON.parse(rawText) as MessagesResponseBody;
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep truncated raw body
      }
      throw new Error(
        `AnthropicAdapter: HTTP ${response.status}: ${redactSecrets(detail, this.apiKey)}`
      );
    }

    let resBody: MessagesResponseBody;
    try {
      resBody = JSON.parse(rawText) as MessagesResponseBody;
    } catch {
      throw new Error("AnthropicAdapter: response was not valid JSON");
    }

    const textBlocks: string[] =
      resBody.content
        ?.filter(
          (block) => block.type === "text" && typeof block.text === "string"
        )
        .map((block) => block.text as string) ?? [];

    const text = textBlocks.join("\n");
    if (!text || text.length === 0) {
      throw new Error(
        "AnthropicAdapter: empty or missing message content in response"
      );
    }

    return {
      text,
      provider: "anthropic",
      model: selectedModel,
    };
  }
}
