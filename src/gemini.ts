/**
 * Google Gemini live provider.
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
} from "./provider-utils.js";

const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiAdapterOptions = GenerationParams & {
  /** @deprecated use {@link GenerationParams.timeoutMs} — kept for source compat */
  baseUrl?: string;
};

type GenerateContentResponseBody = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
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

export class GeminiAdapter implements ModelAdapter {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number | undefined;
  private readonly maxTokens: number | undefined;
  private readonly systemPrompt: string | undefined;

  constructor(options: GeminiAdapterOptions = {}) {
    const key =
      options.apiKey ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_API_KEY ??
      "";
    this.apiKey = key.trim();
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (
      options.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = resolveTimeoutMs(options.timeoutMs);
    this.maxRetries = resolveMaxRetries(options.maxRetries);
    this.temperature = normalizeTemperature(options.temperature);
    this.maxTokens = normalizeMaxTokens(options.maxTokens);
    this.systemPrompt = options.systemPrompt?.trim() || undefined;
  }

  async execute(request: ExecuteRequest): Promise<ModelOutput> {
    if (!this.apiKey) {
      throw new Error(
        "GeminiAdapter: missing API key. Set GEMINI_API_KEY or GOOGLE_API_KEY in the environment."
      );
    }

    if (typeof this.fetchFn !== "function") {
      throw new Error("GeminiAdapter: fetch is not available in this runtime.");
    }

    const selectedModel = request.model ?? this.model;
    const userContent = [request.prompt.trim(), request.input.trim()]
      .filter(Boolean)
      .join("\n\n");

    const temperature =
      request.temperature !== undefined
        ? normalizeTemperature(request.temperature)
        : this.temperature;
    const maxTokens =
      request.maxTokens !== undefined
        ? normalizeMaxTokens(request.maxTokens)
        : this.maxTokens;
    const systemPrompt =
      request.systemPrompt?.trim() || this.systemPrompt;

    // Gemini's generationConfig holds temperature + maxOutputTokens;
    // systemInstruction is a sibling of `contents`.
    const reqBody: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: userContent }],
        },
      ],
    };
    const generationConfig: Record<string, unknown> = {};
    if (temperature !== undefined) {
      generationConfig.temperature = temperature;
    }
    if (maxTokens !== undefined) {
      generationConfig.maxOutputTokens = maxTokens;
    }
    if (Object.keys(generationConfig).length > 0) {
      reqBody.generationConfig = generationConfig;
    }
    if (systemPrompt) {
      // systemInstruction uses the same parts shape as content.
      reqBody.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const url = `${this.baseUrl}/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response: HttpResponse = (await fetchWithRetries(
      this.fetchFn,
      url,
      {
        method: "POST",
        headers: {
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
        const parsed = JSON.parse(rawText) as GenerateContentResponseBody;
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep truncated raw body
      }
      throw new Error(
        `GeminiAdapter: HTTP ${response.status}: ${redactSecrets(detail, this.apiKey)}`
      );
    }

    let resBody: GenerateContentResponseBody;
    try {
      resBody = JSON.parse(rawText) as GenerateContentResponseBody;
    } catch {
      throw new Error("GeminiAdapter: response was not valid JSON");
    }

    const parts = resBody.candidates?.[0]?.content?.parts;
    const textParts: string[] =
      parts
        ?.filter((p) => typeof p.text === "string")
        .map((p) => p.text as string) ?? [];

    const text = textParts.join("");
    if (!text || text.length === 0) {
      throw new Error(
        "GeminiAdapter: empty or missing message content in response"
      );
    }

    return {
      text,
      provider: "gemini",
      model: selectedModel,
    };
  }
}
