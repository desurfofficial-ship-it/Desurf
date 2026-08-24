/**
 * Integration-style tests for runner + repeat using a controllable mock provider.
 * Deterministic — no live model, no randomness.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite } from "../src/runner.js";
import type { ExecuteRequest, ModelAdapter, ModelOutput } from "../src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixtureRoot = resolve(__dirname, "../fixtures/basic");

/** Provider that returns a fixed sequence of outputs / throws. */
class SequenceProvider implements ModelAdapter {
  private index = 0;
  constructor(
    private readonly sequence: Array<{ text?: string; throw?: string }>
  ) {}

  async execute(_request: ExecuteRequest): Promise<ModelOutput> {
    const step = this.sequence[this.index % this.sequence.length];
    this.index++;
    if (step.throw) {
      throw new Error(step.throw);
    }
    return { text: step.text ?? "" };
  }
}

const goodJson = JSON.stringify({
  category: "billing",
  explanation: "Charged twice.",
});

const badJson = JSON.stringify({
  category: "other",
  explanation: "Something else.",
});

describe("runSuite with --repeat (mock provider)", () => {
  it("PASS when all repeats pass", async () => {
    const provider = new SequenceProvider([
      { text: goodJson },
      { text: goodJson },
      { text: goodJson },
    ]);
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      repeat: 3,
      provider,
    });
    expect(summary.cases).toHaveLength(1);
    expect(summary.cases[0].state).toBe("PASS");
    expect(summary.cases[0].passCount).toBe(3);
    expect(summary.passed).toBe(1);
    expect(summary.flaky).toBe(0);
    expect(summary.regression).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("REGRESSION when all repeats fail assertions", async () => {
    const provider = new SequenceProvider([
      { text: badJson },
      { text: badJson },
      { text: badJson },
    ]);
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      repeat: 3,
      provider,
    });
    expect(summary.cases[0].state).toBe("REGRESSION");
    expect(summary.cases[0].failCount).toBe(3);
    expect(summary.regression).toBe(1);
  });

  it("FLAKY when mix of pass and fail", async () => {
    const provider = new SequenceProvider([
      { text: goodJson },
      { text: badJson },
      { text: goodJson },
    ]);
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      repeat: 3,
      provider,
    });
    expect(summary.cases[0].state).toBe("FLAKY");
    expect(summary.cases[0].passCount).toBe(2);
    expect(summary.cases[0].failCount).toBe(1);
    expect(summary.flaky).toBe(1);
  });

  it("ERROR when any execution throws", async () => {
    const provider = new SequenceProvider([
      { text: goodJson },
      { throw: "provider timeout" },
      { text: goodJson },
    ]);
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      repeat: 3,
      provider,
    });
    expect(summary.cases[0].state).toBe("ERROR");
    expect(summary.cases[0].errorCount).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("default repeat is 1", async () => {
    const provider = new SequenceProvider([{ text: goodJson }]);
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      provider,
    });
    expect(summary.cases[0].executions).toHaveLength(1);
    expect(summary.cases[0].state).toBe("PASS");
  });
});
