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

export const META_VERSION = 1;

export type CassetteSource = "seal" | "record";

export type CassetteMeta = {
  version: number;
  inputSha256: string;
  promptSha256: string;
  /**
   * Origin of the sidecar. Optional for v0.3.0 legacy sidecars.
   * - "seal"   → written by `desurf seal`
   * - "record" → written by `desurf record`
   * Missing → treat as sealed (legacy provenance present)
   */
  source?: CassetteSource;
  /** Live provider name when source is "record" */
  provider?: string;
  /** Live model id when source is "record" */
  model?: string;
};

export function sha256(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Sidecar path for a cassette: `<outputPath>.desurf` */
export function metaPathFor(outputPath: string): string {
  return `${outputPath}.desurf`;
}

export function buildMeta(
  inputText: string,
  promptText: string,
  source?: CassetteSource,
  provider?: string,
  model?: string
): CassetteMeta {
  const meta: CassetteMeta = {
    version: META_VERSION,
    inputSha256: sha256(inputText),
    promptSha256: sha256(promptText),
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
  return meta;
}

export async function writeCassetteMeta(
  outputPath: string,
  inputText: string,
  promptText: string,
  source?: CassetteSource,
  provider?: string,
  model?: string
): Promise<void> {
  const meta = buildMeta(inputText, promptText, source, provider, model);
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

const HEX_SHA256_RE = /^[a-f0-9]{64}$/i;

/**
 * Read and validate a sidecar if present.
 * Returns null when missing.
 * Throws on corrupt JSON or missing required hash fields.
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

  if (meta.version !== META_VERSION) {
    throw new Error(
      `Invalid cassette meta file (unsupported version ${String(meta.version)}): ${metaFile}`
    );
  }

  if (
    typeof meta.inputSha256 !== "string" ||
    !HEX_SHA256_RE.test(meta.inputSha256) ||
    typeof meta.promptSha256 !== "string" ||
    !HEX_SHA256_RE.test(meta.promptSha256)
  ) {
    throw new Error(
      `Invalid cassette meta file (inputSha256 and promptSha256 must be 64-char hex SHA-256 hashes): ${metaFile}`
    );
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
  return meta;
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

/**
 * If a meta sidecar exists, verify current input/prompt match the recorded hashes.
 * Throws with a clear message on mismatch (caller maps this to ERROR / exit 2).
 * Missing sidecar → no-op (legacy fixture).
 */
export async function assertCassetteFresh(
  outputPath: string,
  inputText: string,
  promptText: string
): Promise<void> {
  const meta = await readCassetteMeta(outputPath);
  if (!meta) {
    return;
  }

  const inputHash = sha256(inputText);
  const promptHash = sha256(promptText);

  const inputStale = meta.inputSha256 !== inputHash;
  const promptStale = meta.promptSha256 !== promptHash;

  if (!inputStale && !promptStale) {
    return;
  }

  const parts: string[] = [];
  if (promptStale) {
    parts.push("Prompt changed since output was recorded.");
  }
  if (inputStale) {
    parts.push("Input changed since output was recorded.");
  }
  parts.push(
    "Refresh provenance offline with `desurf seal --force` (keeps the existing output), " +
      "re-capture with `desurf record --force` (new provider output), " +
      "or restore the previous input/prompt."
  );
  throw new Error(parts.join(" "));
}
