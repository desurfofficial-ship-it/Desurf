import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Normalized } from "../src/fingerprint.js";
import {
  sanitizeCaseDirName, historyDirFor, writeRecordSnapshot, writeBaselineBackupSnapshot,
  readIndex, readSnapshotFile, markAccepted, listHistory, pickEntry, acceptSnapshot,
  revertToBackup, HistoryError, DEFAULT_HISTORY_LIMIT,
} from "../src/history.js";
import { initSuite } from "../src/init.js";

describe("history store", () => {
  let suiteRoot: string;
  beforeEach(async () => { suiteRoot = await mkdtemp(join(tmpdir(), "desurf-hist-")); });
  afterEach(async () => { await rm(suiteRoot, { recursive: true, force: true }); });

  it("sanitizeCaseDirName rejects unsafe (E1)", () => {
    expect(sanitizeCaseDirName("classify-bad")).toBe("classify-bad");
    expect(() => sanitizeCaseDirName("../etc")).toThrow(HistoryError);
    expect(() => sanitizeCaseDirName("has space")).toThrow(HistoryError);
  });

  it("snapshot round-trip + integrity (E16)", async () => {
    const output = "line1\r\nline2\n";
    const { snapshotPath, file } = await writeRecordSnapshot({
      suiteRoot, caseId: "case-a", output, provider: "openrouter", model: "m",
      inputSha256: "a".repeat(64), promptSha256: "b".repeat(64), baselineSha256AtCapture: null,
      verdictAtCapture: "new", assertionsPassed: true, cliVersion: "0.5.0",
      recordedAt: "2026-09-01T09:15:32.123Z",
    });
    const snap = await readSnapshotFile(snapshotPath);
    expect(snap.output).toBe(output);
    expect(snap.outputSha256).toBe(sha256Normalized(output));
    const { index } = await readIndex(suiteRoot, "case-a");
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].file).toBe(file);
  });

  it("hash tamper (E3)", async () => {
    const { snapshotPath } = await writeRecordSnapshot({
      suiteRoot, caseId: "t", output: "good", provider: null, model: null,
      inputSha256: null, promptSha256: null, baselineSha256AtCapture: null,
      verdictAtCapture: "drift", assertionsPassed: false, cliVersion: "0.5.0",
    });
    const raw = JSON.parse(await readFile(snapshotPath, "utf8"));
    raw.output = "evil";
    await writeFile(snapshotPath, JSON.stringify(raw) + "\n", "utf8");
    await expect(readSnapshotFile(snapshotPath)).rejects.toThrow(/integrity/i);
  });

  it("index rebuild / corrupt (E4)", async () => {
    const { file } = await writeRecordSnapshot({
      suiteRoot, caseId: "rb", output: "hello", provider: "x", model: "y",
      inputSha256: null, promptSha256: null, baselineSha256AtCapture: null,
      verdictAtCapture: "drift", assertionsPassed: null, cliVersion: "0.5.0",
      recordedAt: "2026-09-01T10:00:00.000Z",
    });
    const idxPath = join(historyDirFor(suiteRoot, "rb"), "index.json");
    await rm(idxPath, { force: true });
    const { rebuilt } = await readIndex(suiteRoot, "rb");
    expect(rebuilt).toBe(true);
    await writeFile(idxPath, "{bad", "utf8");
    await expect(readIndex(suiteRoot, "rb")).rejects.toThrow(/corrupt/i);
  });

  it("prune (T16)", async () => {
    for (let i = 0; i < 5; i++) {
      await writeRecordSnapshot({
        suiteRoot, caseId: "p", output: `o${i}`, provider: null, model: null,
        inputSha256: null, promptSha256: null, baselineSha256AtCapture: null,
        verdictAtCapture: "new", assertionsPassed: true, cliVersion: "0.5.0",
        historyLimit: 3, recordedAt: `2026-09-01T10:00:0${i}.000Z`,
      });
    }
    expect((await readIndex(suiteRoot, "p")).index.entries).toHaveLength(3);
  });

  it("same-ms seq (E5)", async () => {
    const at = "2026-09-01T12:00:00.000Z";
    const a = await writeRecordSnapshot({
      suiteRoot, caseId: "ms", output: "a", provider: null, model: null,
      inputSha256: null, promptSha256: null, baselineSha256AtCapture: null,
      verdictAtCapture: "new", assertionsPassed: true, cliVersion: "0.5.0", recordedAt: at,
    });
    const b = await writeRecordSnapshot({
      suiteRoot, caseId: "ms", output: "b", provider: null, model: null,
      inputSha256: null, promptSha256: null, baselineSha256AtCapture: null,
      verdictAtCapture: "drift", assertionsPassed: false, cliVersion: "0.5.0", recordedAt: at,
    });
    expect(a.file).toMatch(/-1\.json$/);
    expect(b.file).toMatch(/-2\.json$/);
  });

  it("accept + revert lifecycle", async () => {
    const suite = join(suiteRoot, "suite");
    await initSuite(suite);
    const caseId = "classify";
    const outputPath = join(suite, "outputs", "classify.json");
    const inputPath = join(suite, "inputs", "classify.txt");
    // find actual paths from suite
    const suiteJson = JSON.parse(await readFile(join(suite, "suite.json"), "utf8"));
    const c = suiteJson.cases[0];
    const cid = c.id;
    const outP = join(suite, c.output);
    const inP = join(suite, c.input);
    const prP = join(suite, c.prompt);
    const old = await readFile(outP, "utf8");
    await writeRecordSnapshot({
      suiteRoot: suite, caseId: cid, output: "NEW-OUTPUT", provider: "openai", model: "m",
      inputSha256: null, promptSha256: null, baselineSha256AtCapture: sha256Normalized(old),
      verdictAtCapture: "drift", assertionsPassed: true, cliVersion: "0.5.0",
    });
    const acc = await acceptSnapshot(suite, cid, outP, inP, prP, { cliVersion: "0.5.0" });
    expect(await readFile(outP, "utf8")).toBe("NEW-OUTPUT");
    expect(acc.backup).toBeTruthy();
    await revertToBackup(suite, cid, outP, {});
    expect(await readFile(outP, "utf8")).toBe(old);
  });

  it("DEFAULT_HISTORY_LIMIT is 10", () => expect(DEFAULT_HISTORY_LIMIT).toBe(10));
});
