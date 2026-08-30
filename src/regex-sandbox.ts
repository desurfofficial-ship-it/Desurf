/**
 * Regex sandbox — evaluates user-supplied regex assertions off the main
 * thread with a hard wall-clock deadline.
 *
 * Why: a catastrophic-backtracking pattern (e.g. `(a+)+$` against a 41-char
 * output) wedges the JavaScript engine forever. There is no in-thread way to
 * interrupt a running RegExp, so evaluation happens in a worker thread that
 * we can terminate on timeout.
 *
 * How the synchronous bridge works (no async ripple through the evaluator):
 *   1. main thread allocates a SharedArrayBuffer (status + result slots)
 *   2. {sab, pattern, flags, text} is posted to the worker (text is cloned)
 *   3. main thread blocks in Atomics.wait(view, STATUS, PENDING, timeout)
 *      — allowed on any thread in Node, and a CLI has nothing else to do
 *   4. the worker stores the result code, flips STATUS, and notifies
 *   5. on timeout the wedged worker is terminated and lazily respawned on
 *      the next evaluation
 *
 * The worker source is an embedded string executed via `new Worker(code,
 * { eval: true })` so the sandbox behaves identically under vitest, tsx
 * (src/*.ts), and the compiled dist/*.js build — no file-resolution or
 * packaging concerns.
 */

import { Worker } from "node:worker_threads";

const STATUS = 0; // 0 = pending, 1 = done
const RESULT = 1; // 1 = match, 2 = no match, 3 = compile error

const WORKER_SOURCE = `
"use strict";
const { parentPort } = require("node:worker_threads");
parentPort.on("message", function (msg) {
  const view = new Int32Array(msg.sab);
  let code = 3;
  try {
    const re = new RegExp(msg.pattern, msg.flags);
    code = re.test(msg.text) ? 1 : 2;
  } catch (err) {
    code = 3;
  }
  Atomics.store(view, ${RESULT}, code);
  Atomics.store(view, ${STATUS}, 1);
  Atomics.notify(view, ${STATUS});
});
`;

export const DEFAULT_REGEX_TIMEOUT_MS = 5_000;

/** Deadline for a single regex evaluation; overridable for CI tuning. */
export function regexTimeoutMs(): number {
  const raw = Number(process.env.DESURF_REGEX_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 100) {
    return Math.floor(raw);
  }
  return DEFAULT_REGEX_TIMEOUT_MS;
}

/** A regex exceeded its evaluation deadline (likely catastrophic backtracking). */
export class RegexTimeoutError extends Error {
  constructor(
    pattern: string,
    flags: string,
    timeoutMs: number
  ) {
    super(
      `Regex evaluation exceeded ${timeoutMs}ms (possible catastrophic backtracking): ` +
        `/${pattern}/${flags} — simplify the pattern, anchor it more tightly, or raise ` +
        `DESURF_REGEX_TIMEOUT_MS if the output is legitimately huge. ` +
        `Refusing to classify this as a behavioral result.`
    );
    this.name = "RegexTimeoutError";
  }
}

/**
 * The regex itself failed to compile in the sandbox. Load-time validation
 * (parseAssertion) already rejects these for suites; this class exists so the
 * direct evaluator API can keep returning its historical
 * "Invalid regex: ..." failed-result instead of throwing.
 */
export class InvalidRegexError extends Error {
  constructor(
    public readonly pattern: string,
    public readonly flags: string,
    public readonly causeMessage: string
  ) {
    super(`Invalid regex: ${causeMessage}`);
    this.name = "InvalidRegexError";
  }
}

export class RegexSandbox {
  private worker: Worker | null = null;

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }
    const w = new Worker(WORKER_SOURCE, { eval: true });
    // Never keep the process (or vitest) alive just for the sandbox.
    w.unref();
    this.worker = w;
    return w;
  }

  private killWorker(): void {
    const w = this.worker;
    this.worker = null;
    if (w) {
      void w.terminate().catch(() => {
        /* already dead */
      });
    }
  }

  /**
   * Synchronously evaluate `pattern` against `text` with a hard deadline.
   * Returns true (match) / false (no match); throws RegexTimeoutError past
   * the deadline and InvalidRegexError for uncompilable patterns.
   */
  test(pattern: string, flags: string, text: string, timeoutMs: number): boolean {
    const sab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const view = new Int32Array(sab);
    view[STATUS] = 0;
    view[RESULT] = 0;

    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      throw new Error(
        `RegexSandbox: could not start evaluation worker: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    try {
      worker.postMessage({ sab, pattern, flags, text });
    } catch (err) {
      this.killWorker();
      throw new Error(
        `RegexSandbox: could not dispatch evaluation: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    const status = Atomics.wait(view, STATUS, 0, timeoutMs);

    if (status === "timed-out") {
      this.killWorker();
      throw new RegexTimeoutError(pattern, flags, timeoutMs);
    }

    const code = Atomics.load(view, RESULT);
    if (code === 1) {
      return true;
    }
    if (code === 2) {
      return false;
    }
    if (code === 3) {
      // Re-compile on the main thread purely to reproduce the engine's own
      // error text for the failed-result message (compilation is fast and
      // cannot backtrack).
      let detail = "invalid pattern";
      try {
        new RegExp(pattern, flags);
      } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
      }
      throw new InvalidRegexError(pattern, flags, detail);
    }
    // Worker died / wrote nothing recognizable: treat as an evaluation hazard.
    this.killWorker();
    throw new Error(
      `RegexSandbox: worker produced no result for /${pattern}/${flags}`
    );
  }

  dispose(): void {
    this.killWorker();
  }
}
