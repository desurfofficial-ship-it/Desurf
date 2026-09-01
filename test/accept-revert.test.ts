import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSuite } from "../src/init.js";
import { recordSuite } from "../src/record.js";
import { acceptSnapshot, revertToBackup, listHistory, pickEntry, HistoryError } from "../src/history.js";
import { sha256Normalized } from "../src/fingerprint.js";
import type { ModelAdapter, ExecuteRequest, ModelOutput } from "../src/types.js";
import { runSuite } from "../src/runner.js";
import { SavedOutputAdapter } from "../src/provider.js";

class MockProvider implements ModelAdapter {
  constructor(private response: string) {}
  async execute(_r: ExecuteRequest): Promise<ModelOutput> {
    return { text: this.response };
  }
}

describe("accept / revert lifecycle", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "desurf-ar-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("record → accept → baseline updated → revert restores (T11-T13)", async () => {
    const suite = join(dir, "s");
    await initSuite(suite);
    const suiteJson = JSON.parse(await readFile(join(suite, "suite.json"), "utf8"));
    const c = suiteJson.cases[0];
    const outP = join(suite, c.output);
    const inP = join(suite, c.input);
    const prP = join(suite, c.prompt);
    const oldBaseline = await readFile(outP, "utf8");
    const oldMeta = await readFile(outP + ".desurf", "utf8");

    // Record drift
    const summary = await recordSuite({
      suitePath: suite,
      provider: new MockProvider("ACCEPTED-NEW-OUTPUT"),
      providerName: "openai",
    });
    expect(summary.results[0].verdict).toBe("drift");
    // baseline untouched
    expect(await readFile(outP, "utf8")).toBe(oldBaseline);

    // Accept
    const acc = await acceptSnapshot(suite, c.id, outP, inP, prP, {
      cliVersion: "0.5.0",
    });
    expect(await readFile(outP, "utf8")).toBe("ACCEPTED-NEW-OUTPUT");
    expect(acc.backup).toBeTruthy();
    const newMeta = JSON.parse(await readFile(outP + ".desurf", "utf8"));
    expect(newMeta.source).toBe("record");

    // Offline test should evaluate against new baseline
    const offline = await runSuite({
      suitePath: suite,
      provider: new SavedOutputAdapter(),
      providerName: "offline",
    });
    // may pass or fail depending on assertions vs new output — just ensure it runs
    expect(offline.cases.length).toBeGreaterThan(0);

    // Revert
    await revertToBackup(suite, c.id, outP, {});
    expect(await readFile(outP, "utf8")).toBe(oldBaseline);
    // Second revert is idempotent (same backup)
    await revertToBackup(suite, c.id, outP, {});
    expect(await readFile(outP, "utf8")).toBe(oldBaseline);
  });

  it("tampered snapshot refused (T15)", async () => {
    const suite = join(dir, "t");
    await initSuite(suite);
    const suiteJson = JSON.parse(await readFile(join(suite, "suite.json"), "utf8"));
    const c = suiteJson.cases[0];
    const outP = join(suite, c.output);
    const inP = join(suite, c.input);
    const prP = join(suite, c.prompt);

    await recordSuite({
      suitePath: suite,
      provider: new MockProvider("drifted"),
      providerName: "openai",
    });
    const listed = await listHistory(suite, c.id);
    const file = listed[0].entries[0].file;
    const snapPath = join(suite, ".desurf-history", c.id, file);
    const raw = JSON.parse(await readFile(snapPath, "utf8"));
    raw.output = "TAMPERED";
    await writeFile(snapPath, JSON.stringify(raw, null, 2) + "\n", "utf8");

    await expect(
      acceptSnapshot(suite, c.id, outP, inP, prP, { cliVersion: "0.5.0" })
    ).rejects.toThrow(/integrity/i);
    // baseline unchanged
    const baseline = await readFile(outP, "utf8");
    expect(baseline).not.toBe("TAMPERED");
  });

  it("nothing to accept when no pending", async () => {
    const suite = join(dir, "n");
    await initSuite(suite);
    const suiteJson = JSON.parse(await readFile(join(suite, "suite.json"), "utf8"));
    const c = suiteJson.cases[0];
    await expect(
      acceptSnapshot(suite, c.id, join(suite, c.output), join(suite, c.input), join(suite, c.prompt), {
        cliVersion: "0.5.0",
      })
    ).rejects.toThrow(HistoryError);
  });
});
