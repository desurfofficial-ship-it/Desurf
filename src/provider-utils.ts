/**
 * Shared live-provider utilities.
 *
 * Determinism, retry, and timeout knobs that every HTTP-based provider
 * (OpenRouter / OpenAI / Anthropic / Gemini) needs. Keeping the logic in
 * one place ensures the four adapters stay in lockstep — a cassette
 * recorded with one provider should be re-recordable with the same
 * generation parameters on any other.
 *
 * Why these defaults exist:
 * - `temperature: 0` (default): a recorded cassette is meant to be a
 *   reproducible baseline. The default sampling temperature of most
 *   providers is 1.0 (stochastic), so `desurf record --force` against an
 *   identical prompt/input could legitimately produce a different output
 *   and the very next `desurf test` would report a "regression" that is
 *   really just sampling noise. Pinning temperature to 0 makes the
 *   offline-cassette guarantee — "the saved output corresponds to these
 *   files" — actually hold. Users who want stochastic sampling can pass
 *   `--temperature` explicitly.
 * - `seed` (optional, passthrough): some OpenAI-compatible endpoints
 *   honor a seed for best-effort determinism on top of temperature 0.
 * - `maxTokens` (optional): protects against runaway completions and
 *   lets CI budgets be predictable.
 * - `timeoutMs`: was hardcoded to 30s in every adapter; long-running
 *   models (o1, deep-research) cannot be tested at all. Now overridable
 *   via `--timeout-ms` / `DESURF_TIMEOUT_MS`.
 * - `maxRetries`: transient 429/5xx/network errors previously flipped a
 *   case from PASS to ERROR on a single blip. With `--max-retries 2`,
 *   a 429 mid-suite no longer fails the gate.
 */

/** Default per-request deadline (ms). Matches prior hardcoded behavior. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Minimum sensible timeout — guards against `--timeout-ms 1` typos. */
export const MIN_TIMEOUT_MS = 1_000;

/** Maximum sensible timeout — guards against `--timeout-ms 999999999`. */
export const MAX_TIMEOUT_MS = 600_000;

/** Default retry count. 0 preserves prior single-attempt behavior. */
export const DEFAULT_MAX_RETRIES = 0;

/** Hard ceiling on retries — each retry is a billed network call. */
export const MAX_MAX_RETRIES = 5;

/** Default sampling temperature for all live providers (deterministic). */
export const DEFAULT_TEMPERATURE = 0;

/** Reasonable default output cap for providers that accept max_tokens. */
export const DEFAULT_MAX_TOKENS = 4096;

/** Lower bound for an explicit temperature (below 0 is invalid everywhere). */
export const MIN_TEMPERATURE = 0;

/** Upper bound for an explicit temperature (2.0 is the max any provider accepts). */
export const MAX_TEMPERATURE = 2;

/**
 * Resolve a timeout in ms from, in priority order:
 *   1. an explicit caller value
 *   2. `DESURF_TIMEOUT_MS` env var
 *   3. {@link DEFAULT_TIMEOUT_MS}
 *
 * Clamps to [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS] so a typo cannot make a
 * request either instantaneous or effectively infinite.
 */
export function resolveTimeoutMs(explicit?: number): number {
  if (explicit !== undefined) {
    if (!Number.isFinite(explicit) || explicit < MIN_TIMEOUT_MS || explicit > MAX_TIMEOUT_MS) {
      throw new Error(
        `timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} (got ${explicit})`
      );
    }
    return Math.floor(explicit);
  }
  const env = Number(process.env.DESURF_TIMEOUT_MS);
  if (Number.isFinite(env) && env >= MIN_TIMEOUT_MS && env <= MAX_TIMEOUT_MS) {
    return Math.floor(env);
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Resolve a retry count from, in priority order:
 *   1. an explicit caller value
 *   2. `DESURF_MAX_RETRIES` env var
 *   3. {@link DEFAULT_MAX_RETRIES}
 *
 * Clamps to [0, MAX_MAX_RETRIES].
 */
export function resolveMaxRetries(explicit?: number): number {
  if (explicit !== undefined) {
    if (!Number.isInteger(explicit) || explicit < 0 || explicit > MAX_MAX_RETRIES) {
      throw new Error(
        `maxRetries must be an integer between 0 and ${MAX_MAX_RETRIES} (got ${explicit})`
      );
    }
    return explicit;
  }
  const env = Number(process.env.DESURF_MAX_RETRIES);
  if (Number.isInteger(env) && env >= 0 && env <= MAX_MAX_RETRIES) {
    return env;
  }
  return DEFAULT_MAX_RETRIES;
}

/**
 * Validate an explicit temperature. Returns `undefined` for "use provider
 * default" — but the providers default to {@link DEFAULT_TEMPERATURE}, not
 * to the upstream API default, so that recorded cassettes stay reproducible.
 */
export function normalizeTemperature(
  explicit?: number
): number | undefined {
  if (explicit === undefined) {
    return DEFAULT_TEMPERATURE;
  }
  if (typeof explicit !== "number" || !Number.isFinite(explicit)) {
    throw new Error(
      `temperature must be a finite number between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE} (got ${JSON.stringify(explicit)})`
    );
  }
  if (explicit < MIN_TEMPERATURE || explicit > MAX_TEMPERATURE) {
    throw new Error(
      `temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE} (got ${explicit})`
    );
  }
  return explicit;
}

/**
 * Validate an explicit maxTokens. Returns `undefined` for "omit" so that
 * providers which require it (Anthropic) apply their own default and
 * providers which don't (OpenAI/OpenRouter) don't send it.
 */
export function normalizeMaxTokens(
  explicit?: number
): number | undefined {
  if (explicit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(explicit) || explicit < 1) {
    throw new Error(
      `max-tokens must be a positive integer (got ${JSON.stringify(explicit)})`
    );
  }
  if (explicit > 1_000_000) {
    throw new Error(
      `max-tokens unreasonably large (got ${explicit}; cap is 1,000,000)`
    );
  }
  return explicit;
}

/**
 * Validate an explicit seed. Returns `undefined` for "omit". Seeds are a
 * best-effort determinism hint; not all providers honor them.
 */
export function normalizeSeed(explicit?: number): number | undefined {
  if (explicit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(explicit) || explicit < 0) {
    throw new Error(
      `seed must be a non-negative integer (got ${JSON.stringify(explicit)})`
    );
  }
  if (explicit > Number.MAX_SAFE_INTEGER) {
    throw new Error(`seed exceeds Number.MAX_SAFE_INTEGER (got ${explicit})`);
  }
  return explicit;
}

/** HTTP statuses worth retrying: transient server / rate-limit class. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** Whether a thrown fetch error is the kind that deserves a retry. */
export function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const name = err.name;
  const msg = err.message;
  // TimeoutError / AbortError are retryable ONLY when the caller opted into
  // retries (they're handled by fetchWithRetries below). ECONNRESET, ENOTFOUND
  // (transient DNS), socket hang, etc. are retryable.
  if (name === "TimeoutError" || name === "AbortError") {
    return true;
  }
  return (
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|socket hang up|network error/i.test(
      msg
    )
  );
}

/** Sleep helper that does not block the event loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Exponential backoff with jitter: 250ms, 500ms, 1000ms, 2000ms, capped.
 * Jitter prevents thundering-herd retries against a rate-limited endpoint.
 */
export function backoffMs(attempt: number): number {
  const base = 250 * Math.pow(2, attempt);
  const capped = Math.min(base, 4000);
  // Jitter in [0, capped/2]
  return Math.floor(capped / 2 + Math.random() * (capped / 2));
}

/**
 * Run a fetch operation with retries on transient HTTP/network failures.
 *
 * `attempt` is 0-indexed. The fetch factory receives an AbortSignal with the
 * remaining per-attempt timeout. On a transient failure with retries
 * remaining, the promise rejects with a {@link RetryableError} carrying the
 * last error; only after exhausting retries does it rethrow.
 *
 * The caller is responsible for inspecting `response.ok` / `response.status`
 * and throwing to signal retryability; this wrapper inspects the thrown
 * error (status embedded by {@link statusError} / network classification).
 */
export async function fetchWithRetries(
  fetchFn: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number,
  redactSecrets: (s: string) => string = (s) => s
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;
    try {
      response = (await fetchFn(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      })) as Response;
    } catch (err) {
      lastError = err;
      const name = err instanceof Error ? err.name : "";
      const raw = err instanceof Error ? err.message : String(err);
      const msg = redactSecrets(raw);
      const isTimeout =
        name === "TimeoutError" ||
        name === "AbortError" ||
        /aborted|timeout/i.test(msg);
      if (attempt < maxRetries && (isTimeout || isRetryableNetworkError(err))) {
        await sleep(backoffMs(attempt));
        continue;
      }
      if (isTimeout) {
        throw new Error(`request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`network error: ${msg}`);
    }
    // Response received.
    if (response.ok) {
      return response;
    }
    // Non-ok response. If it's NOT a retryable status (e.g. 400/401/403/404),
    // return it to the caller — the caller inspects response.ok and throws a
    // provider-specific error with redaction. Retrying a 401 would be wrong.
    if (!isRetryableStatus(response.status)) {
      return response;
    }
    // Retryable status (408/429/5xx). If we're out of retry budget, return
    // the response so the caller's response handling formats the final error.
    if (attempt >= maxRetries) {
      return response;
    }
    // Transient HTTP status with retries remaining: back off and retry.
    await sleep(backoffMs(attempt));
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("fetchWithRetries: exhausted retries with no error captured");
}
