/**
 * Provider abstraction.
 * Stage 1 ships only the SavedOutputAdapter.
 */

import { readFile } from "node:fs/promises";
import type { ExecuteRequest, ModelAdapter, ModelOutput } from "./types.js";

/** Transcript cassette shape for multi-turn cases (D3). */
export type TranscriptCassette = {
  version: 1;
  turns: Array<{ user: string; output: string }>;
};

/**
 * Loads a previously saved model output from disk.
 * Makes the whole system offline-first and deterministic.
 *
 * When `turnIndex` is set and `outputPath` ends in `.json`, parses the
 * transcript and returns `turns[turnIndex].output` (D4 offline replay).
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

    if (request.turnIndex !== undefined) {
      if (!request.outputPath.endsWith(".json")) {
        throw new Error(
          `Offline turnIndex=${request.turnIndex} requires a .json transcript at ${request.outputPath}`
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(
          `Malformed transcript at ${request.outputPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as TranscriptCassette).turns)
      ) {
        throw new Error(
          `Malformed transcript at ${request.outputPath}: expected { version, turns: [...] }`
        );
      }
      const tr = parsed as TranscriptCassette;
      if (request.turnIndex < 0 || request.turnIndex >= tr.turns.length) {
        throw new Error(
          `Transcript turn index ${request.turnIndex} out of range (transcript has ${tr.turns.length} turns) at ${request.outputPath}`
        );
      }
      const turn = tr.turns[request.turnIndex];
      if (turn === undefined || typeof turn.output !== "string") {
        throw new Error(
          `Transcript turn ${request.turnIndex} missing output string at ${request.outputPath}`
        );
      }
      return { text: turn.output };
    }

    return { text };
  }
}
