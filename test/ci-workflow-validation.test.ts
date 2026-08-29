import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("GitHub Actions workflow validation", () => {
  it("examples/github-actions/desurf.yml has correct branch syntax and valid structure", async () => {
    const yamlPath = resolve("examples/github-actions/desurf.yml");
    const content = await readFile(yamlPath, "utf8");

    // Ensure it does not have the typo 'branches: ain]'
    expect(content).not.toMatch(/branches:\s*ain\]/);

    // Verify correct branches array syntax
    expect(content).toMatch(/branches:\s*\[main\]/);

    // Verify offline-only, no OPENROUTER_API_KEY set in environment
    expect(content).not.toMatch(/env:\s*[\s\S]*OPENROUTER_API_KEY/);

    // Verify workflow runs desurf test
    expect(content).toMatch(/desurf test --suite/);

    // Verify basic YAML structure: name, on, jobs
    expect(content).toMatch(/^name:\s*.+/m);
    expect(content).toMatch(/^on:\s*/m);
    expect(content).toMatch(/^jobs:\s*/m);
  });

  it(".github/workflows/ci.yml has correct branch syntax and runs offline regression gate", async () => {
    const yamlPath = resolve(".github/workflows/ci.yml");
    const content = await readFile(yamlPath, "utf8");

    expect(content).not.toMatch(/branches:\s*ain\]/);
    expect(content).toMatch(/branches:\s*\[main/);
    expect(content).toMatch(/node dist\/cli\.js test --suite/);
  });
});
