/**
 * desurf init — create a minimal runnable offline suite.
 */

import { mkdir, writeFile, access, constants } from "node:fs/promises";
import { resolve, basename, join } from "node:path";

const SUITE_JSON = `{
  "name": "PLACEHOLDER_NAME",
  "cases": [
    {
      "id": "example-case",
      "input": "inputs/example.txt",
      "prompt": "prompts/example.txt",
      "output": "outputs/example.txt",
      "assertions": [
        { "type": "required", "value": "hello" },
        { "type": "forbidden", "value": "I am an AI" }
      ]
    }
  ]
}
`;

const INPUT_TXT = `What is 2 + 2?
`;

const PROMPT_TXT = `Answer the user's question briefly.
`;

const OUTPUT_TXT = `The answer is 4. hello from the example output.
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
  await writeFile(join(inputsDir, "example.txt"), INPUT_TXT, "utf8");
  await writeFile(join(promptsDir, "example.txt"), PROMPT_TXT, "utf8");
  await writeFile(join(outputsDir, "example.txt"), OUTPUT_TXT, "utf8");

  return abs;
}
