/**
 * Provider selection — offline remains default.
 */

import { describe, it, expect } from "vitest";
import { createProvider } from "../src/create-provider.js";
import { OpenRouterAdapter } from "../src/openrouter.js";
import { SavedOutputAdapter } from "../src/provider.js";
import { runSuite } from "../src/runner.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const fixtureRoot = resolve(__dirname, "../fixtures/basic");

describe("provider selection + offline default", () => {
  it("runSuite without provider still uses offline SavedOutputAdapter", async () => {
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      repeat: 1,
    });
    expect(summary.cases[0].state).toBe("PASS");
    expect(summary.passed).toBe(1);
  });

  it("explicit offline provider works", async () => {
    const summary = await runSuite({
      suitePath: fixtureRoot,
      caseId: "support-classifier-good",
      provider: createProvider({ provider: "offline" }),
    });
    expect(summary.cases[0].state).toBe("PASS");
  });

  it("createProvider aliases", () => {
    expect(createProvider({ provider: "saved" })).toBeInstanceOf(
      SavedOutputAdapter
    );
    expect(createProvider({ provider: "OpenRouter" })).toBeInstanceOf(
      OpenRouterAdapter
    );
  });
});
