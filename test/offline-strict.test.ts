/**
 * Tests for the strict-suite-loader hardening added in the post-0.4 patch:
 * - non-string case ids are rejected at load (was silently accepted, but
 *   unselectable via --case)
 * - output/input/prompt fields that name suite.json itself are rejected
 *   (was a self-clobber / data-loss path)
 * - non-string input/prompt/output/assertions fields are rejected at the
 *   JSON boundary (a number like 123 slipped through the old truthy check
 *   and crashed resolveCasePath later)
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSuite } from "../src/offline.js";

async function writeSuite(dir: string, suite: unknown): Promise<string> {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "inputs"), { recursive: true });
  await mkdir(join(dir, "prompts"), { recursive: true });
  await mkdir(join(dir, "outputs"), { recursive: true });
  await writeFile(join(dir, "inputs", "i.txt"), "input\n");
  await writeFile(join(dir, "prompts", "p.txt"), "prompt\n");
  await writeFile(join(dir, "outputs", "o.txt"), "output\n");
  await writeFile(join(dir, "suite.json"), JSON.stringify(suite, null, 2));
  return dir;
}

describe("loadSuite strict id validation", () => {
  it("rejects a numeric case id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-id-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: 123,
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /non-empty string "id".*Numeric or boolean ids/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a boolean case id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-id-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: true,
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(/non-empty string "id"/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an empty-string case id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-id-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(/non-empty string "id"/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts a valid string case id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-id-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "valid-case",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "output" }],
          },
        ],
      });
      const suite = await loadSuite(dir);
      expect(suite.cases[0].id).toBe("valid-case");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadSuite strict field types", () => {
  it("rejects a numeric input field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-field-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: 123,
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /field "input" must be a non-empty string/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a numeric prompt field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-field-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "inputs/i.txt",
            prompt: 456,
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /field "prompt" must be a non-empty string/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a numeric output field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-field-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: 789,
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /field "output" must be a non-empty string/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-array assertions field", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-field-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: "required",
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /field "assertions" must be an array/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadSuite self-clobber guard", () => {
  it("rejects output path that resolves to suite.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-clobber-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "suite.json",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /must not name the suite file itself/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects output path that resolves to suite.json via ./ prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-clobber-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "./suite.json",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /must not name the suite file itself/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects input path that resolves to suite.json (reads suite structure as input)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-clobber-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "suite.json",
            prompt: "prompts/p.txt",
            output: "outputs/o.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /must not name the suite file itself/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts an output path that merely contains the substring 'suite.json'", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-clobber-"));
    try {
      await mkdir(join(dir, "outputs", "suite.json-backup"), { recursive: true });
      await writeSuite(dir, {
        name: "n",
        cases: [
          {
            id: "c1",
            input: "inputs/i.txt",
            prompt: "prompts/p.txt",
            output: "outputs/suite.json-backup/result.txt",
            assertions: [{ type: "required", value: "x" }],
          },
        ],
      });
      const suite = await loadSuite(dir);
      expect(suite.cases[0].id).toBe("c1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadSuite top-level type guards", () => {
  it("rejects a suite file that is a JSON array (not an object)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-tl-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "suite.json"), JSON.stringify([1, 2, 3]));
      await expect(loadSuite(dir)).rejects.toThrow(/must contain a JSON object/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a suite file that is a JSON primitive (not an object)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-tl-"));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "suite.json"), "42");
      await expect(loadSuite(dir)).rejects.toThrow(/must contain a JSON object/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a case that is not an object", async () => {
    const dir = await mkdtemp(join(tmpdir(), "desurf-tl-"));
    try {
      await writeSuite(dir, {
        name: "n",
        cases: ["not-an-object"],
      });
      await expect(loadSuite(dir)).rejects.toThrow(
        /Each case must be a JSON object/i
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
