/**
 * Anthropic live provider.
 * Implements ModelAdapter. Native fetch only.
 * Does not log or expose API credentials.
 */

import type { ExecuteRequest, ModelAdapter, ModelOutput } from "./types.js";

const DEFAULT_MODEL = "claude-3-5-haiku-20241022";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicAdapterOptions = {
  /** Defaults to process.env.ANTHROPIC_API_KEY */
  apiKey?: string;
  /** Defaults to claude-3-5-haiku-20241022 */
  model?: string;
  /** Defaults to https://api.anthropic.com/v1 */
  baseUrl?: string;
  /** Injected for tests; defaults to global fetch */
  fetch?: typeof globalThis.fetch;
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
    const userContent = [request.prompt.trim(), request.input.trim()]
      .filter(Boolean)
      .join("\n\n");

    const url = `${this.baseUrl}/messages`;
    let response: HttpResponse;
    try {
      response = (await this.fetchFn(url, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: selectedModel,
          max_tokens: 4096,
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
          `AnthropicAdapter: request timed out after ${DEFAULT_TIMEOUT_MS}ms`
        );
      }
      throw new Error(`AnthropicAdapter: network error: ${msg}`);
    }

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

    let body: MessagesResponseBody;
    try {
      body = JSON.parse(rawText) as MessagesResponseBody;
    } catch {
      throw new Error("AnthropicAdapter: response was not valid JSON");
    }

    const textBlocks =
      body.content
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
