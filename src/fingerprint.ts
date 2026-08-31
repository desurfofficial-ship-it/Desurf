/**
 * Cassette fingerprinting for stale-fixture detection.
 *
 * When a saved output was recorded against a specific input+prompt, those
 * contents are hashed and stored in a sidecar next to the output file.
 * Offline `desurf test` verifies the hashes before evaluating assertions.
 *
 * Missing sidecars are treated as legacy fixtures (no check) so existing
 * suites keep working without a forced migration.
 */

import { createHash } from "node:crypto";
import { access, constants, readFile } from "node:fs/promises";
import { atomicWriteFile } from "./fs-utils.js";

export const META_VERSION = 2;

/** Legacy sidecar version: input/prompt only, byte-exact hashes. */
export const LEGACY_META_VERSION = 1;

export type CassetteSource = "seal" | "record";

/**
 * Severity of an input/prompt drift against a sealed/recorded cassette.
 * - "hard"  → the cassette cannot be trusted to stand for the current
 *   input/prompt pair; the run is an ERROR (exit 2). Unchanged behavior.
 * - "soft"  → the drift is a WARNING: the saved output is still evaluated
 *   against the current assertions, but the result is explicitly labeled
 *   as based on a drifted baseline (prompt/input changed since the
 *   cassette was recorded). The run stays green (exit 0) unless the
 *   assertions themselves fail.
 *
 * Default for `seal` (explicit, offline) is "hard". `record` (live
 * capture) writes "soft" so the natural iterate → re-record loop stops
 * crying wolf on intentional prompt edits.
 */
export type DriftSeverity = "hard" | "soft";

export type CassetteMeta = {
  version: number;
  inputSha256: string;
  promptSha256: string;
  /**
   * v2 only: fingerprint of the sealed output text. Detects a cassette
   * edited after seal/record — without it, assertions evaluate against
   * whatever bytes are on disk and provenance stays nominally "fresh".
   */
  outputSha256?: string;
  /**
   * Origin of the sidecar. Optional for v0.3.0 legacy sidecars.
   * - "seal"   → written by `desurf seal`
   * - "record" → written by `desurf record`
   * Missing → treat as sealed (legacy provenance present)
   */
  source?: CassetteSource;
  /**
   * How drift of this cassette is reported at test time.
   * - "hard": drift → ERROR (exit 2). Default when source is "seal".
   * - "soft": drift → WARNING (evaluated against current assertions,
   *   run stays green unless assertions fail). Default when source is
   *   "record".
   * Missing → "hard" for sealed/legacy sidecars, "soft" for recorded.
   * Unknown values are rejected on read (configuration error).
   */
  drift?: DriftSeverity;
  /** Live provider name when source is "record" */
  provider?: string;
  /** Live model id when source is "record" */
  model?: string;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * sha256 over CRLF→LF-normalized text.
 *
 * v1 hashed raw bytes: the identical suite checked out with git autocrlf
 * on Windows hashed differently than on Linux, so every cross-platform
 * re-checkout reported STALE (false alarm — no one changed anything).
 * v2 hashes normalized text, so a fixture is fresh on any platform as
 * long as only line endings differ. Real content changes still change
 * the hash.
 */
export function sha256Normalized(text: string): string {
  return sha256(text.replace(/\r\n/g, "\n"));
}

/** Sidecar path for a cassette: `<outputPath>.desurf` */
export function metaPathFor(outputPath: string): string {
  return `${outputPath}.desurf`;
}

/**
 * Build cassette provenance metadata.
 *
 * - Without `outputText` (legacy call shape): writes a v1 sidecar with
 *   byte-exact input/prompt hashes, exactly like previous releases.
 * - With `outputText` (all built-in commands): writes a v2 sidecar with
 *   EOL-normalized hashes plus outputSha256, enabling tamper detection
 *   and cross-platform line-ending tolerance.
 */
export function buildMeta(
  inputText: string,
  promptText: string,
  source?: CassetteSource,
  outputText?: string,
  provider?: string,
  model?: string,
  drift: DriftSeverity = "hard"
): CassetteMeta {
  if (outputText === undefined) {
    // Legacy v1 builder: frozen semantics, byte-exact hashes.
    const legacy: CassetteMeta = {
      version: LEGACY_META_VERSION,
      inputSha256: sha256(inputText),
      promptSha256: sha256(promptText),
    };
    if (source) {
      legacy.source = source;
    }
    if (provider) {
      legacy.provider = provider;
    }
    if (model) {
      legacy.model = model;
    }
    return legacy;
  }

  const meta: CassetteMeta = {
    version: META_VERSION,
    inputSha256: sha256Normalized(inputText),
    promptSha256: sha256Normalized(promptText),
    outputSha256: sha256Normalized(outputText),
  };
  if (source) {
    meta.source = source;
  }
  if (provider) {
    meta.provider = provider;
  }
  if (model) {
    meta.model = model;
  }
  // Recorded cassettes are ALWAYS soft (live capture is expected to be
  // refreshed; drift is a warning). Sealed/legacy cassettes take the
  // caller's severity (default "hard").
  meta.drift = source === "record" ? "soft" : drift;
  return meta;
}

/**
 * Default drift severity for a sidecar being written.
 * - seal → hard (drift is a hard ERROR; test refuses to run against a
 *   baseline that no longer corresponds to the files under test)
 * - record → soft (live-captured cassettes are expected to be refreshed;
 *   drift is a visible warning, not a hard failure)
 */
export function defaultDriftFor(source: CassetteSource | undefined): DriftSeverity {
  return source === "record" ? "soft" : "hard";
}

export async function writeCassetteMeta(
  outputPath: string,
  inputText: string,
  promptText: string,
  source?: CassetteSource,
  outputText?: string,
  provider?: string,
  model?: string,
  drift: DriftSeverity = "hard"
): Promise<void> {
  // Recorded cassettes are always soft (see buildMeta); sealed/legacy
  // cassettes take the caller's severity (default "hard").
  const effective = source === "record" ? "soft" : drift;
  const meta = buildMeta(
    inputText,
    promptText,
    source,
    outputText,
    provider,
    model,
    effective
  );
  await atomicWriteFile(
    metaPathFor(outputPath),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8"
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}


export type CassetteStateLabel = "unsealed" | "sealed" | "recorded";

/**
 * Map raw/legacy meta to a public cassette state label.
 * Missing sidecar → unsealed.
 * source "record" → recorded.
 * source "seal" or missing source (legacy) → sealed.
 */
export function cassetteStateFromMeta(
  meta: CassetteMeta | null
): CassetteStateLabel {
  if (!meta) return "unsealed";
  if (meta.source === "record") return "recorded";
  return "sealed";
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Read and validate a sidecar if present.
 * Returns null when missing.
 * Throws on corrupt JSON, unknown version, malformed hash values, or a
 * v2 sidecar missing its output fingerprint.
 */
export async function readCassetteMeta(
  outputPath: string
): Promise<CassetteMeta | null> {
  const metaFile = metaPathFor(outputPath);
  if (!(await pathExists(metaFile))) {
    return null;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(metaFile, "utf8"));
  } catch {
    throw new Error(
      `Invalid cassette meta file (corrupt JSON): ${metaFile}`
    );
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Invalid cassette meta file (must be a JSON object): ${metaFile}`
    );
  }

  const meta = raw as CassetteMeta;

  // Version must be a known integer. Previously ANY version value was
  // accepted and silently trusted (a "version": 99 sidecar with nonsense
  // hashes half-validated), so hand-edited or corrupt sidecars produced
  // divergent verdicts between test and inspect instead of a hard error.
  if (
    typeof meta.version !== "number" ||
    !Number.isInteger(meta.version) ||
    (meta.version !== LEGACY_META_VERSION && meta.version !== META_VERSION)
  ) {
    throw new Error(
      `Invalid cassette meta file (unsupported version ${JSON.stringify(
        (raw as { version?: unknown }).version
      )}; this desurf reads versions 1 and 2): ${metaFile}`
    );
  }

  // Hash fields must be real sha256 digests (64 lowercase hex chars).
  // Anything else means the sidecar was hand-edited or corrupted; letting
  // it through turns provenance into a string comparison with garbage.
  if (!HEX64.test(meta.inputSha256) || !HEX64.test(meta.promptSha256)) {
    throw new Error(
      `Invalid cassette meta file (inputSha256/promptSha256 must be 64-character lowercase hex sha256 values): ${metaFile}`
    );
  }

  if (meta.version === META_VERSION) {
    if (typeof meta.outputSha256 !== "string" || !HEX64.test(meta.outputSha256)) {
      throw new Error(
        `Invalid cassette meta file (version 2 requires a 64-character lowercase hex outputSha256): ${metaFile}`
      );
    }
  }

  if (
    meta.source !== undefined &&
    meta.source !== "seal" &&
    meta.source !== "record"
  ) {
    throw new Error(
      `Invalid cassette meta file (unknown source "${String(meta.source)}"): ${metaFile}`
    );
  }

  if (
    meta.drift !== undefined &&
    meta.drift !== "hard" &&
    meta.drift !== "soft"
  ) {
    throw new Error(
      `Invalid cassette meta file (unknown drift severity "${String(meta.drift)}"): ${metaFile}`
    );
  }
  return meta;
}

/**
 * Effective drift severity for a cassette.
 * - explicit meta.drift wins
 * - recorded sidecars without drift default to "soft"
 * - sealed/legacy sidecars default to "hard"
 */
export function cassetteDrift(meta: CassetteMeta | null): DriftSeverity {
  if (!meta) return "hard";
  if (meta.drift === "soft" || meta.drift === "hard") return meta.drift;
  return meta.source === "record" ? "soft" : "hard";
}

/**
 * Report cassette provenance state for an offline cassette.
 * Does not validate hashes (use assertCassetteFresh / inspect for that).
 */
export async function readCassetteState(
  outputPath: string
): Promise<CassetteStateLabel> {
  try {
    const meta = await readCassetteMeta(outputPath);
    return cassetteStateFromMeta(meta);
  } catch {
    return "unsealed";
  }
}

export type CassetteFreshness = {
  fresh: boolean;
  promptStale: boolean;
  inputStale: boolean;
  /** Effective drift severity of the cassette (soft = warning, hard = error). */
  severity: DriftSeverity;
};

/**
 * If a meta sidecar exists, compare current input/prompt against the
 * recorded hashes. Returns a structured freshness report; callers decide
 * whether drift is a hard error or a warning.
 * Missing sidecar → { fresh: true } (legacy fixture).
 *
 * Hash mode follows the sidecar version: v1 compares byte-exact (frozen
 * legacy semantics), v2 compares CRLF-normalized (autocrlf tolerance).
 */
export async function checkCassetteFresh(
  outputPath: string,
  inputText: string,
  promptText: string
): Promise<CassetteFreshness> {
  const meta = await readCassetteMeta(outputPath);
  if (!meta) {
    return { fresh: true, promptStale: false, inputStale: false, severity: "hard" };
  }

  const hash = meta.version >= META_VERSION ? sha256Normalized : sha256;
  const inputHash = hash(inputText);
  const promptHash = hash(promptText);

  const promptStale = meta.promptSha256 !== promptHash;
  const inputStale = meta.inputSha256 !== inputHash;

  return {
    fresh: !promptStale && !inputStale,
    promptStale,
    inputStale,
    severity: cassetteDrift(meta),
  };
}

function driftParts(promptStale: boolean, inputStale: boolean): string[] {
  const parts: string[] = [];
  if (promptStale) {
    parts.push("Prompt changed since output was recorded.");
  }
  if (inputStale) {
    parts.push("Input changed since output was recorded.");
  }
  return parts;
}

/**
 * If a meta sidecar exists, verify current input/prompt match the recorded
 * hashes. Throws with a clear message on mismatch.
 *
 * Missing sidecar → no-op (legacy fixture).
 *
 * Hard cassettes (sealed / legacy) throw → the caller maps this to ERROR
 * (exit 2): the saved output no longer corresponds to the files under
 * test, so Desurf refuses to treat the result as a contract verdict.
 *
 * Soft cassettes (recorded) throw {@link SoftDriftError}: the caller maps
 * this to a visible WARNING and still evaluates the current assertions
 * against the drifted baseline, keeping the run green (exit 0) unless the
 * assertions themselves fail.
 */
export async function assertCassetteFresh(
  outputPath: string,
  inputText: string,
  promptText: string
): Promise<void> {
  const freshness = await checkCassetteFresh(outputPath, inputText, promptText);
  if (freshness.fresh) {
    return;
  }

  const parts = driftParts(freshness.promptStale, freshness.inputStale);
  parts.push(
    "Refresh provenance offline with `desurf seal --force` (keeps the existing output), " +
      "re-capture with `desurf record --force` (new provider output), " +
      "or restore the previous input/prompt."
  );
  const message = parts.join(" ");

  if (freshness.severity === "soft") {
    throw new SoftDriftError(message);
  }
  throw new Error(message);
}

/**
 * Marker error for drift against a soft (recorded) cassette.
 * The runner maps it to a WARNING instead of an ERROR.
 */
export class SoftDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SoftDriftError";
  }
}

/**
 * Verify (v2 sidecars only) that the saved output still matches the
 * fingerprint recorded at seal/record time. Without this check the
 * cassette itself was never authenticated: anyone could edit the output
 * file to make assertions pass and provenance still said "fresh".
 * v1 sidecars cannot verify this (no outputSha256) and are skipped —
 * re-seal to upgrade. Missing sidecar → no-op (legacy fixture).
 */
export async function verifyCassetteOutput(
  outputPath: string,
  outputText: string
): Promise<void> {
  const meta = await readCassetteMeta(outputPath);
  if (!meta || meta.version < META_VERSION || meta.outputSha256 === undefined) {
    return;
  }
  if (meta.outputSha256 !== sha256Normalized(outputText)) {
    // v0.4.3: wording is cassette-source aware. A tampered *recorded*
    // cassette says "modified after recording"; a sealed one says
    // "modified after sealing". The old text always said "sealing",
    // which was misleading for record-sourced cassettes.
    const sourceLabel =
      meta.source === "record" ? "modified after recording" : "modified after sealing";
    throw new Error(
      `Saved output was ${sourceLabel} (outputSha256 mismatch): ${outputPath}. ` +
        `The assertions would run against bytes that no longer match the ${meta.source === "record" ? "recorded" : "sealed"} cassette. ` +
        `Restore the original output, or if the change is intentional refresh provenance ` +
        `with \`desurf seal --force\` (keep edited output) or \`desurf record --force\` (new provider output).`
    );
  }
}
