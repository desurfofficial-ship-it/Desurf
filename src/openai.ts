/**
 * OpenAI live provider.
 * Implements ModelAdapter. Native fetch only.
 * Does not log or expose API credentials.
 */

import type { ExecuteRequest, ModelAdapter, ModelOutput } from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;

export type OpenAIAdapterOptions = {
  /** Defaults to process.env.OPENAI_API_KEY */
  apiKey?: string;
  /** Defaults to gpt-4o-mini */
  model?: string;
  /** Defaults to https://api.openai.com/v1 */
  baseUrl?: string;
  /** Injected for tests; defaults to global fetch */
  fetch?: typeof globalThis.fetch;
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
    const userContent = [request.prompt.trim(), request.input.trim()]
      .filter(Boolean)
      .join("\n\n");

    const url = `${this.baseUrl}/chat/completions`;
    let response: HttpResponse;
    try {
      response = (await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: "user", content: userContent }],
        }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })) as HttpResponse;
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const raw = err instanceof Error ? err.message : String(err);
      const msg = redactSecrets(raw, this.apiKey);
      if (
        name === "TimeoutError" ||
        name === "AbortError" ||
        /aborted|timeout/i.test(msg)
      ) {
        throw new Error(
          `OpenAIAdapter: request timed out after ${DEFAULT_TIMEOUT_MS}ms`
        );
      }
      throw new Error(`OpenAIAdapter: network error: ${msg}`);
    }

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
