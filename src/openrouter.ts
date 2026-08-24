/**
 * OpenRouter live provider.
 * Implements ModelAdapter. All HTTP and response parsing stay here.
 * Does not log or expose API credentials.
 */

import type { ExecuteRequest, ModelAdapter, ModelOutput } from "./types.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
/** Request timeout for live OpenRouter calls (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

export type OpenRouterAdapterOptions = {
  /** Defaults to process.env.OPENROUTER_API_KEY */
  apiKey?: string;
  /** Defaults to openai/gpt-4o-mini */
  model?: string;
  /** Defaults to https://openrouter.ai/api/v1 */
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
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(options: OpenRouterAdapterOptions = {}) {
    const key = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.apiKey = key.trim();
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
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

    // Live path ignores outputPath; input + prompt form the user message.
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
          model: this.model,
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
          `OpenRouterAdapter: request timed out after ${DEFAULT_TIMEOUT_MS}ms`
        );
      }
      throw new Error(`OpenRouterAdapter: network error: ${msg}`);
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

    return { text };
  }
}
