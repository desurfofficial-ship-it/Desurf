/**
 * desurf init — create a minimal runnable offline suite that teaches the real workflow.
 *
 * Generated layout:
 *   suite.json
 *   inputs/support-request.txt   — what the model receives as user input
 *   prompts/classify.txt         — the instruction / prompt under test
 *   outputs/classify.json        — recorded model output (cassette)
 *
 * The example is a structured support-classifier contract so a new developer
 * immediately sees: input → prompt → saved output → assertions → deterministic result.
 */

import { mkdir, writeFile, access, constants } from "node:fs/promises";
import { resolve, basename, join } from "node:path";

const SUITE_JSON = `{
  "name": "PLACEHOLDER_NAME",
  "cases": [
    {
      "id": "example-case",
      "input": "inputs/support-request.txt",
      "prompt": "prompts/classify.txt",
      "output": "outputs/classify.json",
      "assertions": [
        { "type": "forbidden", "value": "I am an AI", "caseSensitive": false },
        {
          "type": "json_schema",
          "schema": {
            "type": "object",
            "required": ["category", "reason"],
            "properties": {
              "category": {
                "enum": ["billing", "technical", "account", "other"]
              }
            }
          }
        },
        {
          "type": "regex",
          "pattern": "\\"category\\"\\\\s*:\\\\s*\\"technical\\""
        }
      ]
    }
  ]
}
`;

const INPUT_TXT = `My app keeps crashing when I try to export a report. Error code: OPS-503.
`;

const PROMPT_TXT = `Classify the support request and return JSON only.

Return a JSON object with:
  "category" — one of: billing, technical, account, other
  "reason"   — a short explanation of why this category fits

Do not include markdown fences or extra commentary.
`;

const OUTPUT_JSON = `{
  "category": "technical",
  "reason": "The issue involves an operational failure or system error (OPS-503 crash on export)."
}
`;

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a minimal suite at targetDir.
 * Refuses if the directory already contains suite structure.
 * Returns the absolute path of the created suite directory.
 */
export async function initSuite(targetDir: string): Promise<string> {
  const abs = resolve(targetDir);

  const suiteJson = join(abs, "suite.json");
  const inputsDir = join(abs, "inputs");
  const promptsDir = join(abs, "prompts");
  const outputsDir = join(abs, "outputs");

  if (await pathExists(suiteJson)) {
    throw new Error(
      `Refusing to overwrite existing suite: ${suiteJson} already exists. Choose an empty directory or remove the existing suite.`
    );
  }

  for (const d of [inputsDir, promptsDir, outputsDir]) {
    if (await pathExists(d)) {
      throw new Error(
        `Refusing to overwrite existing suite structure: ${d} already exists. Choose an empty directory or remove the existing suite.`
      );
    }
  }

  await mkdir(abs, { recursive: true });
  await mkdir(inputsDir, { recursive: true });
  await mkdir(promptsDir, { recursive: true });
  await mkdir(outputsDir, { recursive: true });

  const name = basename(abs) || "my-suite";
  const suiteContent = SUITE_JSON.replace("PLACEHOLDER_NAME", name);

  await writeFile(suiteJson, suiteContent, "utf8");
  await writeFile(join(inputsDir, "support-request.txt"), INPUT_TXT, "utf8");
  await writeFile(join(promptsDir, "classify.txt"), PROMPT_TXT, "utf8");
  await writeFile(join(outputsDir, "classify.json"), OUTPUT_JSON, "utf8");

  return abs;
}
