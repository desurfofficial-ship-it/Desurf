/**
 * Filesystem utilities for safe, atomic writes.
 */

import { writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Atomically writes data to a file by writing to a temporary file in the
 * same directory and renaming it into place.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
  encoding: BufferEncoding = "utf8"
): Promise<void> {
  const dir = dirname(filePath);
  const baseName = filePath.split("/").pop() || "file";
  const tempPath = join(
    dir,
    `.${baseName}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`
  );

  try {
    await writeFile(tempPath, data, encoding);
    await rename(tempPath, filePath);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup error if temp file does not exist
    }
    throw err;
  }
}
