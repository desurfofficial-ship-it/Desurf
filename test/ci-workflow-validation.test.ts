import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("GitHub Actions workflow validation", () => {
  it("examples/github-actions/desurf.yml has correct branch syntax and valid structure", async () => {
    const yamlPath = resolve("examples/github-actions/desurf.yml");
    const content = await readFile(yamlPath, "utf8");

    expect(content).not.toMatch(/branches:\s*ain\]/
    expect(content).toMatch(/branches:\s*\[main\]/
    expect(content).not.toMatch(/env:\s*[\s\S]*OPENROUTER_API_KEY/);

    expect(
      /desurf test --suite/.test(content) ||
        /uses:\s*desurfofficial-ship-it\/Desurf@/.test(content)
    ).toBe(true);

    expect(content).toMatch(/^name:\s*.+/m);
    expect(content).toMatch(/^on:\s*/m);
    expect(content).toMatch(/^jobs:\s*/m);
  });

  it(".github/workflows/ci.yml has correct branch syntax and runs offline regression gate", async () => {
    const yamlPath = resolve(".github/workflows/ci.yml");
    const content = await readFile(yamlPath, "utf8");

    expect(content).not.toMatch(/branches:\s*ain\]/
    expect(content).toMatch(/branches:\s*\[main/);
    expect(content).toMatch(/node dist\/cli\.js test --suite/);
  });
});
