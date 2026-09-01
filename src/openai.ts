/**
 * OpenAI live provider.
 * Implements ModelAdapter. Native fetch only.
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

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export type OpenAIAdapterOptions = GenerationParams & {
  /** @deprecated use {@link GenerationParams.timeoutMs} — kept for source compat */
  baseUrl?: string;
};

type ChatCompletionsBody = {
  choices?: Array<{
    message?: { content?: string | null };
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

export class OpenAIAdapter implements ModelAdapter {
  readonly name = "openai";
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

  constructor(options: OpenAIAdapterOptions = {}) {
    const key = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.apiKey = key.trim();
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (
      options.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.maxRetries = resolveMaxRetries(options.maxRetries);
    this.temperature = normalizeTemperature(options.temperature);
    this.seed = normalizeSeed(options.seed);
    this.maxTokens = normalizeMaxTokens(options.maxTokens);
    this.systemPrompt = options.systemPrompt?.trim() || undefined;
  }

  async execute(request: ExecuteRequest): Promise<ModelOutput> {
    if (!this.apiKey) {
      throw new Error(
        "OpenAIAdapter: missing API key. Set OPENAI_API_KEY in the environment."
      );
    }

    if (typeof this.fetchFn !== "function") {
      throw new Error("OpenAIAdapter: fetch is not available in this runtime.");
    }

    const selectedModel = request.model ?? this.model;
    const hasHistory = Boolean(request.history && request.history.length > 0);
    // Multi-turn (D4): history present → input is the current user turn only;
    // prompt falls through as system. Single-turn keeps legacy join behavior.
    const userContent = hasHistory
      ? request.input.trim()
      : [request.prompt.trim(), request.input.trim()].filter(Boolean).join("\n\n");

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
      request.systemPrompt?.trim() ||
      this.systemPrompt ||
      (hasHistory ? request.prompt.trim() || undefined : undefined);

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    if (hasHistory && request.history) {
      for (const h of request.history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: "user", content: userContent });

    const reqBody: Record<string, unknown> = {
      model: selectedModel,
      messages,
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
        `OpenAIAdapter: HTTP ${response.status}: ${redactSecrets(detail, this.apiKey)}`
      );
    }

    let body: ChatCompletionsBody;
    try {
      body = JSON.parse(rawText) as ChatCompletionsBody;
    } catch {
      throw new Error("OpenAIAdapter: response was not valid JSON");
    }

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(
        "OpenAIAdapter: empty or missing message content in response"
      );
    }

    return {
      text,
      provider: "openai",
      model: selectedModel,
    };
  }
}
