/**
 * Cassette history store — integrity-verified snapshots + ring-buffer index.
 * Offline by construction. Used by record (propose), accept, revert, diff, history.
 */

import {
  access,
  constants,
  mkdir,
  readdir,
  readFile,
  unlink,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./fs-utils.js";
import {
  sha256Normalized,
  writeCassetteMeta,
  readCassetteMeta,
  metaPathFor,
  type CassetteMeta,
} from "./fingerprint.js";

export const HISTORY_SCHEMA_VERSION = 1;
export const DEFAULT_HISTORY_LIMIT = 10;
export const MIN_HISTORY_LIMIT = 1;
export const MAX_HISTORY_LIMIT = 100;

const SAFE_CASE_ID = /^[A-Za-z0-9._-]+$/;

export type SnapshotKind = "record" | "baseline-backup";
export type RecordVerdict = "new" | "drift";

export type HistorySnapshot = {
  schemaVersion: number;
  kind: SnapshotKind;
  caseId: string;
  recordedAt: string;
  cliVersion: string;
  provider: string | null;
  model: string | null;
  inputSha256: string | null;
  promptSha256: string | null;
  baselineSha256AtCapture: string | null;
  output: string;
  outputSha256: string;
  verdictAtCapture: RecordVerdict | null;
  assertionsPassed: boolean | null;
  metaAtCapture: CassetteMeta | null;
};

export type IndexEntry = {
  file: string;
  kind: SnapshotKind;
  verdictAtCapture: RecordVerdict | null;
  recordedAt: string;
  outputSha256: string;
  assertionsPassed: boolean | null;
  acceptedAt: string | null;
};

export type HistoryIndex = {
  schemaVersion: number;
  entries: IndexEntry[];
};

export class HistoryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "integrity"
      | "corrupt-index"
      | "unsafe-id"
      | "io"
      | "not-found" = "io"
  ) {
    super(message);
    this.name = "HistoryError";
  }
}

export function sanitizeCaseDirName(caseId: string): string {
  if (!caseId || !SAFE_CASE_ID.test(caseId)) {
    throw new HistoryError(
      `Unsafe case id for history directory: ${JSON.stringify(caseId)}. ` +
        `Case ids used with history must match [A-Za-z0-9._-].`,
      "unsafe-id"
    );
  }
  return caseId;
}

export function historyRoot(suiteRoot: string): string {
  return join(suiteRoot, ".desurf-history");
}

export function historyDirFor(suiteRoot: string, caseId: string): string {
  return join(historyRoot(suiteRoot), sanitizeCaseDirName(caseId));
}

export function indexPathFor(suiteRoot: string, caseId: string): string {
  return join(historyDirFor(suiteRoot, caseId), "index.json");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function clampHistoryLimit(n: number | undefined): number {
  if (n === undefined || Number.isNaN(n)) return DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(n) || n < MIN_HISTORY_LIMIT || n > MAX_HISTORY_LIMIT) {
    throw new HistoryError(
      `--history-limit must be an integer between ${MIN_HISTORY_LIMIT} and ${MAX_HISTORY_LIMIT} (got ${n})`,
      "io"
    );
  }
  return n;
}

export function snapshotFilenameStem(iso: string): string {
  return iso.replace(/:/g, "-").replace(/\./g, "-");
}

export async function nextSnapshotFilename(
  dir: string,
  recordedAt: string
): Promise<string> {
  const stem = snapshotFilenameStem(recordedAt);
  let seq = 1;
  while (seq < 1000) {
    const name = `${stem}-${seq}.json`;
    if (!(await pathExists(join(dir, name)))) return name;
    seq++;
  }
  throw new HistoryError(`Could not allocate unique snapshot filename under ${dir}`, "io");
}

export function verifySnapshotIntegrity(snapshot: HistorySnapshot): void {
  if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== HISTORY_SCHEMA_VERSION) {
    throw new HistoryError(`Snapshot has invalid schemaVersion (expected ${HISTORY_SCHEMA_VERSION})`, "integrity");
  }
  if (typeof snapshot.output !== "string") {
    throw new HistoryError("Snapshot missing output string", "integrity");
  }
  if (typeof snapshot.outputSha256 !== "string") {
    throw new HistoryError("Snapshot missing outputSha256", "integrity");
  }
  const actual = sha256Normalized(snapshot.output);
  if (actual !== snapshot.outputSha256) {
    throw new HistoryError(
      `Snapshot integrity failure: sha256Normalized(output) !== outputSha256 (expected ${snapshot.outputSha256}, got ${actual})`,
      "integrity"
    );
  }
}

export async function readSnapshotFile(filePath: string): Promise<HistorySnapshot> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new HistoryError(`Snapshot file is corrupt or unreadable: ${filePath}`, "integrity");
  }
  const snap = raw as HistorySnapshot;
  verifySnapshotIntegrity(snap);
  return snap;
}

export async function readIndex(
  suiteRoot: string,
  caseId: string
): Promise<{ index: HistoryIndex; rebuilt: boolean }> {
  const dir = historyDirFor(suiteRoot, caseId);
  const idxPath = indexPathFor(suiteRoot, caseId);

  if (!(await pathExists(dir))) {
    return { index: { schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] }, rebuilt: false };
  }

  if (await pathExists(idxPath)) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(idxPath, "utf8"));
    } catch {
      throw new HistoryError(
        `index.json is corrupt; delete it to force a rebuild from snapshots: ${idxPath}`,
        "corrupt-index"
      );
    }
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      (raw as HistoryIndex).schemaVersion !== HISTORY_SCHEMA_VERSION ||
      !Array.isArray((raw as HistoryIndex).entries)
    ) {
      throw new HistoryError(
        `index.json is corrupt; delete it to force a rebuild from snapshots: ${idxPath}`,
        "corrupt-index"
      );
    }
    return { index: raw as HistoryIndex, rebuilt: false };
  }

  const files = (await readdir(dir))
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort();
  const entries: IndexEntry[] = [];
  for (const file of files) {
    try {
      const snap = await readSnapshotFile(join(dir, file));
      entries.push({
        file,
        kind: snap.kind,
        verdictAtCapture: snap.verdictAtCapture,
        recordedAt: snap.recordedAt,
        outputSha256: snap.outputSha256,
        assertionsPassed: snap.assertionsPassed,
        acceptedAt: null,
      });
    } catch {
      /* skip corrupt during rebuild */
    }
  }
  const index: HistoryIndex = { schemaVersion: HISTORY_SCHEMA_VERSION, entries };
  if (entries.length > 0) {
    await atomicWriteFile(idxPath, JSON.stringify(index, null, 2) + "\n", "utf8");
  }
  return { index, rebuilt: entries.length > 0 };
}

async function writeIndex(suiteRoot: string, caseId: string, index: HistoryIndex): Promise<void> {
  const dir = historyDirFor(suiteRoot, caseId);
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(indexPathFor(suiteRoot, caseId), JSON.stringify(index, null, 2) + "\n", "utf8");
}

export async function appendAndPrune(
  suiteRoot: string,
  caseId: string,
  entry: IndexEntry,
  historyLimit: number = DEFAULT_HISTORY_LIMIT
): Promise<void> {
  const limit = clampHistoryLimit(historyLimit);
  const { index } = await readIndex(suiteRoot, caseId);
  index.entries.push(entry);
  const dir = historyDirFor(suiteRoot, caseId);
  while (index.entries.length > limit) {
    const evicted = index.entries.shift()!;
    try {
      await unlink(join(dir, evicted.file));
    } catch {
      /* gone */
    }
  }
  await writeIndex(suiteRoot, caseId, index);
}

export type WriteRecordSnapshotArgs = {
  suiteRoot: string;
  caseId: string;
  output: string;
  provider: string | null;
  model: string | null;
  inputSha256: string | null;
  promptSha256: string | null;
  baselineSha256AtCapture: string | null;
  verdictAtCapture: RecordVerdict;
  assertionsPassed: boolean | null;
  cliVersion: string;
  historyLimit?: number;
  recordedAt?: string;
};

export async function writeRecordSnapshot(
  args: WriteRecordSnapshotArgs
): Promise<{ snapshotPath: string; relativePath: string; file: string }> {
  const dir = historyDirFor(args.suiteRoot, args.caseId);
  await mkdir(dir, { recursive: true });
  const idxPath = indexPathFor(args.suiteRoot, args.caseId);
  if (!(await pathExists(idxPath))) {
    await writeIndex(args.suiteRoot, args.caseId, { schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] });
  }

  const recordedAt = args.recordedAt ?? new Date().toISOString();
  const file = await nextSnapshotFilename(dir, recordedAt);
  const outputSha256 = sha256Normalized(args.output);

  const snapshot: HistorySnapshot = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    kind: "record",
    caseId: args.caseId,
    recordedAt,
    cliVersion: args.cliVersion,
    provider: args.provider,
    model: args.model,
    inputSha256: args.inputSha256,
    promptSha256: args.promptSha256,
    baselineSha256AtCapture: args.baselineSha256AtCapture,
    output: args.output,
    outputSha256,
    verdictAtCapture: args.verdictAtCapture,
    assertionsPassed: args.assertionsPassed,
    metaAtCapture: null,
  };

  const abs = join(dir, file);
  await atomicWriteFile(abs, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  await appendAndPrune(
    args.suiteRoot,
    args.caseId,
    {
      file,
      kind: "record",
      verdictAtCapture: args.verdictAtCapture,
      recordedAt,
      outputSha256,
      assertionsPassed: args.assertionsPassed,
      acceptedAt: null,
    },
    args.historyLimit
  );

  return { snapshotPath: abs, relativePath: join(".desurf-history", args.caseId, file), file };
}

export type WriteBaselineBackupArgs = {
  suiteRoot: string;
  caseId: string;
  output: string;
  metaAtCapture: CassetteMeta | null;
  cliVersion: string;
  provider?: string | null;
  model?: string | null;
  historyLimit?: number;
  recordedAt?: string;
};

export async function writeBaselineBackupSnapshot(
  args: WriteBaselineBackupArgs
): Promise<{ snapshotPath: string; relativePath: string; file: string }> {
  const dir = historyDirFor(args.suiteRoot, args.caseId);
  await mkdir(dir, { recursive: true });
  const idxPath = indexPathFor(args.suiteRoot, args.caseId);
  if (!(await pathExists(idxPath))) {
    await writeIndex(args.suiteRoot, args.caseId, { schemaVersion: HISTORY_SCHEMA_VERSION, entries: [] });
  }

  const recordedAt = args.recordedAt ?? new Date().toISOString();
  const file = await nextSnapshotFilename(dir, recordedAt);
  const outputSha256 = sha256Normalized(args.output);

  const snapshot: HistorySnapshot = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    kind: "baseline-backup",
    caseId: args.caseId,
    recordedAt,
    cliVersion: args.cliVersion,
    provider: args.provider ?? null,
    model: args.model ?? null,
    inputSha256: null,
    promptSha256: null,
    baselineSha256AtCapture: null,
    output: args.output,
    outputSha256,
    verdictAtCapture: null,
    assertionsPassed: null,
    metaAtCapture: args.metaAtCapture,
  };

  const abs = join(dir, file);
  await atomicWriteFile(abs, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  await appendAndPrune(
    args.suiteRoot,
    args.caseId,
    {
      file,
      kind: "baseline-backup",
      verdictAtCapture: null,
      recordedAt,
      outputSha256,
      assertionsPassed: null,
      acceptedAt: null,
    },
    args.historyLimit
  );

  return { snapshotPath: abs, relativePath: join(".desurf-history", args.caseId, file), file };
}

export async function markAccepted(
  suiteRoot: string,
  caseId: string,
  file: string,
  acceptedAt?: string
): Promise<void> {
  const { index } = await readIndex(suiteRoot, caseId);
  const entry = index.entries.find((e) => e.file === file);
  if (!entry) {
    throw new HistoryError(`No index entry for snapshot ${file} in case ${caseId}`, "not-found");
  }
  entry.acceptedAt = acceptedAt ?? new Date().toISOString();
  await writeIndex(suiteRoot, caseId, index);
}

export async function listHistory(
  suiteRoot: string,
  caseId?: string
): Promise<Array<{ caseId: string; pendingReview: boolean; entries: IndexEntry[]; rebuilt: boolean }>> {
  const root = historyRoot(suiteRoot);
  if (!(await pathExists(root))) return [];

  let caseIds: string[];
  if (caseId) {
    sanitizeCaseDirName(caseId);
    caseIds = [caseId];
  } else {
    const dirs = await readdir(root, { withFileTypes: true });
    caseIds = dirs.filter((d) => d.isDirectory()).map((d) => d.name).sort();
  }

  const out: Array<{ caseId: string; pendingReview: boolean; entries: IndexEntry[]; rebuilt: boolean }> = [];
  for (const id of caseIds) {
    const dir = historyDirFor(suiteRoot, id);
    if (!(await pathExists(dir))) {
      if (caseId) out.push({ caseId: id, pendingReview: false, entries: [], rebuilt: false });
      continue;
    }
    const { index, rebuilt } = await readIndex(suiteRoot, id);
    const entries = [...index.entries].reverse();
    const pendingReview = entries.some((e) => e.kind === "record" && e.acceptedAt === null);
    out.push({ caseId: id, pendingReview, entries, rebuilt });
  }
  return out;
}

export async function pickEntry(
  suiteRoot: string,
  caseId: string,
  entry?: string | number,
  opts?: { kind?: SnapshotKind; pendingOnly?: boolean }
): Promise<{ entry: IndexEntry; snapshot: HistorySnapshot; absPath: string }> {
  const { index } = await readIndex(suiteRoot, caseId);
  if (index.entries.length === 0) {
    throw new HistoryError(`no history for case ${caseId}`, "not-found");
  }

  let candidates = [...index.entries].reverse();
  if (opts?.kind) candidates = candidates.filter((e) => e.kind === opts.kind);
  if (opts?.pendingOnly) {
    candidates = candidates.filter((e) => e.kind === "record" && e.acceptedAt === null);
  }

  let chosen: IndexEntry | undefined;
  if (entry === undefined || entry === null || entry === "") {
    chosen = candidates[0];
  } else if (typeof entry === "number" || /^\d+$/.test(String(entry))) {
    const n = typeof entry === "number" ? entry : parseInt(String(entry), 10);
    if (n < 1 || n > candidates.length) {
      throw new HistoryError(`Entry ${n} out of range (1..${candidates.length}) for case ${caseId}`, "not-found");
    }
    chosen = candidates[n - 1];
  } else {
    const name = String(entry);
    chosen = candidates.find((e) => e.file === name) ?? index.entries.find((e) => e.file === name);
  }

  if (!chosen) {
    throw new HistoryError(`No matching history entry for case ${caseId}`, "not-found");
  }

  const absPath = join(historyDirFor(suiteRoot, caseId), chosen.file);
  const snapshot = await readSnapshotFile(absPath);
  if (snapshot.outputSha256 !== chosen.outputSha256) {
    throw new HistoryError(`Index/snapshot hash mismatch for ${chosen.file}`, "integrity");
  }
  return { entry: chosen, snapshot, absPath };
}

export type AcceptResult = { caseId: string; snapshot: string; backup: string | null };

export async function acceptSnapshot(
  suiteRoot: string,
  caseId: string,
  outputPath: string,
  inputPath: string,
  promptPath: string,
  opts: {
    entry?: string | number;
    historyLimit?: number;
    cliVersion: string;
    provider?: string;
    model?: string;
  }
): Promise<AcceptResult> {
  const { entry, snapshot } = await pickEntry(suiteRoot, caseId, opts.entry, {
    kind: "record",
    pendingOnly: opts.entry === undefined,
  });

  let backupRel: string | null = null;
  if (await pathExists(outputPath)) {
    try {
      const s = await stat(outputPath);
      if (s.isFile() && s.size > 0) {
        const baselineText = await readFile(outputPath, "utf8");
        let meta = null;
        try {
          meta = await readCassetteMeta(outputPath);
        } catch {
          meta = null;
        }
        const backup = await writeBaselineBackupSnapshot({
          suiteRoot,
          caseId,
          output: baselineText,
          metaAtCapture: meta,
          cliVersion: opts.cliVersion,
          provider: opts.provider ?? null,
          model: opts.model ?? null,
          historyLimit: opts.historyLimit,
        });
        backupRel = backup.relativePath;
      }
    } catch {
      /* no baseline */
    }
  }

  await atomicWriteFile(outputPath, snapshot.output, "utf8");

  const [inputText, promptText] = await Promise.all([
    readFile(inputPath, "utf8"),
    readFile(promptPath, "utf8"),
  ]);
  await writeCassetteMeta(
    outputPath,
    inputText,
    promptText,
    "record",
    snapshot.output,
    opts.provider ?? snapshot.provider ?? undefined,
    opts.model ?? snapshot.model ?? undefined
  );

  await markAccepted(suiteRoot, caseId, entry.file);

  return {
    caseId,
    snapshot: join(".desurf-history", caseId, entry.file),
    backup: backupRel,
  };
}

export type RevertResult = { caseId: string; restoredFrom: string };

export async function revertToBackup(
  suiteRoot: string,
  caseId: string,
  outputPath: string,
  opts: { entry?: string | number }
): Promise<RevertResult> {
  const { entry, snapshot } = await pickEntry(suiteRoot, caseId, opts.entry, {
    kind: "baseline-backup",
  });

  await atomicWriteFile(outputPath, snapshot.output, "utf8");

  const metaFile = metaPathFor(outputPath);
  if (snapshot.metaAtCapture && typeof snapshot.metaAtCapture === "object") {
    await atomicWriteFile(metaFile, JSON.stringify(snapshot.metaAtCapture, null, 2) + "\n", "utf8");
  } else {
    try {
      await unlink(metaFile);
    } catch {
      /* already absent */
    }
  }

  return { caseId, restoredFrom: join(".desurf-history", caseId, entry.file) };
}

export async function removeCaseHistory(suiteRoot: string, caseId: string): Promise<void> {
  const dir = historyDirFor(suiteRoot, caseId);
  if (await pathExists(dir)) await rm(dir, { recursive: true, force: true });
}
