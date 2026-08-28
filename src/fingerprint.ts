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
import { access, constants, readFile, writeFile } from "node:fs/promises";

export const META_VERSION = 1;

export type CassetteMeta = {
  version: number;
  inputSha256: string;
  promptSha256: string;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Sidecar path for a cassette: `<outputPath>.desurf` */
export function metaPathFor(outputPath: string): string {
  return `${outputPath}.desurf`;
}

export function buildMeta(inputText: string, promptText: string): CassetteMeta {
  return {
    version: META_VERSION,
    inputSha256: sha256(inputText),
    promptSha256: sha256(promptText),
  };
}

export async function writeCassetteMeta(
  outputPath: string,
  inputText: string,
  promptText: string
): Promise<void> {
  const meta = buildMeta(inputText, promptText);
  await writeFile(metaPathFor(outputPath), JSON.stringify(meta, null, 2) + "\n", "utf8");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
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
  const metaFile = metaPathFor(outputPath);
  if (!(await pathExists(metaFile))) {
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(metaFile, "utf8"));
  } catch {
    throw new Error(
      `Invalid cassette meta file (corrupt JSON): ${metaFile}`
    );
  }

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    typeof (raw as CassetteMeta).inputSha256 !== "string" ||
    typeof (raw as CassetteMeta).promptSha256 !== "string"
  ) {
    throw new Error(
      `Invalid cassette meta file (missing inputSha256/promptSha256): ${metaFile}`
    );
  }

  const meta = raw as CassetteMeta;
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
    "Re-record the cassette (`desurf record --force`) or restore the previous input/prompt."
  );
  throw new Error(parts.join(" "));
}
