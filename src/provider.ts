/**
 * Provider abstraction.
 * Stage 1 ships only the SavedOutputAdapter.
 */

import { readFile } from "node:fs/promises";
import type { ExecuteRequest, ModelAdapter, ModelOutput } from "./types.js";

/**
 * Loads a previously saved model output from disk.
 * Makes the whole system offline-first and deterministic.
 */
export class SavedOutputAdapter implements ModelAdapter {
  readonly name = "offline";
  async execute(request: ExecuteRequest): Promise<ModelOutput> {
    if (!request.outputPath) {
      throw new Error(
        "SavedOutputAdapter requires request.outputPath (offline mode)"
      );
    }

    const text = await readFile(request.outputPath, "utf8");
    return { text };
  }
}
