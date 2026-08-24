/**
 * Stage 4 — public example integration tests.
 * Demonstrates PASS, REGRESSION, and FLAKY deterministically.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite } from "../src/runner.js";
import type { ExecuteRequest, ModelAdapter, ModelOutput } from "../src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const exampleRoot = resolve(__dirname, "../examples/support-agent");

const goodJson = JSON.stringify({
  category: "billing",
  explanation: "Customer appears to have been charged twice.",
});

const badJson = JSON.stringify({
  category: "other",
  explanation: "I am an AI language model and cannot help.",
});

/** Deterministic provider for FLAKY demonstration. */
class SequenceProvider implements ModelAdapter {
  private index = 0;
  constructor(
    private readonly sequence: Array<{ text?: string; throw?: string }>
  ) {}

  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    const step = this.sequence[this.index % this.sequence.length];
    this.index++;
    if (step.throw) throw new Error(step.throw);
    return { text: step.text ?? "" };
  }
}

describe("examples/support-agent (public example)", () => {
  it("good case → PASS (offline saved output)", async () => {
    const summary = await runSuite({
      suitePath: exampleRoot,
      caseId: "support-classifier-good",
      repeat: 3,
    });
    expect(summary.cases).toHaveLength(1);
    expect(summary.cases[0].state).toBe("PASS");
    expect(summary.cases[0].passCount).toBe(3);
    expect(summary.passed).toBe(1);
    expect(summary.regression).toBe(0);
    expect(summary.flaky).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("regressed case → REGRESSION (offline saved output)", async () => {
    const summary = await runSuite({
      suitePath: exampleRoot,
      caseId: "support-classifier-regressed",
      repeat: 3,
    });
    expect(summary.cases).toHaveLength(1);
    expect(summary.cases[0].state).toBe("REGRESSION");
    expect(summary.cases[0].failCount).toBe(3);
    expect(summary.regression).toBe(1);
    expect(summary.passed).toBe(0);
  });

  it("full suite offline → 1 PASS + 1 REGRESSION", async () => {
    const summary = await runSuite({
      suitePath: exampleRoot,
      repeat: 1,
    });
    expect(summary.cases).toHaveLength(2);
    expect(summary.passed).toBe(1);
    expect(summary.regression).toBe(1);
    expect(summary.flaky).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("FLAKY via deterministic mock provider (varying outputs)", async () => {
    const provider = new SequenceProvider([
      { text: goodJson },
      { text: badJson },
      { text: goodJson },
    ]);
    const summary = await runSuite({
      suitePath: exampleRoot,
      caseId: "support-classifier-good",
      repeat: 3,
      provider,
    });
    expect(summary.cases[0].state).toBe("FLAKY");
    expect(summary.cases[0].passCount).toBe(2);
    expect(summary.cases[0].failCount).toBe(1);
    expect(summary.flaky).toBe(1);
  });
});
