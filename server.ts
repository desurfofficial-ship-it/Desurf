import express from "express";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { runSuite } from "./dist/runner.js";
import { initSuite } from "./dist/init.js";
import { recordSuite } from "./dist/record.js";
import { createProvider } from "./dist/create-provider.js";
import { loadSuite } from "./dist/offline.js";
import type { Suite } from "./src/types.js";

const execAsync = promisify(exec);
const app = express();
const PORT = 3000;

app.use(express.json());

// Recursive helper to discover all suite.json files in workspace
async function discoverSuites(dir: string, results: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const suiteFile = join(fullPath, "suite.json");
        if (existsSync(suiteFile)) {
          results.push(fullPath);
        }
        await discoverSuites(fullPath, results);
      }
    }
  } catch {
    // ignore access issues
  }
  return results;
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "Desurf", version: "0.3.0" });
});

// Environment configuration check
app.get("/api/env-status", (_req, res) => {
  res.json({
    openRouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 0),
  });
});

// List all discovered suites
app.get("/api/suites", async (_req, res) => {
  try {
    const cwd = process.cwd();
    const suiteDirs = await discoverSuites(cwd);
    const suitesData = [];

    for (const sDir of suiteDirs) {
      try {
        const loaded: Suite = await loadSuite(sDir);
        suitesData.push({
          path: relative(cwd, sDir) || ".",
          absPath: sDir,
          name: loaded.name,
          caseCount: loaded.cases.length,
          cases: loaded.cases.map((c) => ({
            id: c.id,
            inputPath: relative(sDir, c.input),
            promptPath: relative(sDir, c.prompt),
            outputPath: relative(sDir, c.outputPath),
            assertionCount: c.assertions.length,
            assertionTypes: c.assertions.map((a) => a.type),
          })),
        });
      } catch (err) {
        console.warn(`Failed to parse suite at ${sDir}:`, err);
      }
    }

    res.json({ suites: suitesData });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get deep detail of a specific suite including file contents
app.get("/api/suite-detail", async (req, res) => {
  try {
    const rawPath = String(req.query.path || "fixtures/basic");
    const suiteDir = resolve(process.cwd(), rawPath);
    const suite = await loadSuite(suiteDir);

    const detailedCases = await Promise.all(
      suite.cases.map(async (c) => {
        let inputText = "";
        let promptText = "";
        let outputText = "";
        let inputFound = false;
        let promptFound = false;
        let outputFound = false;

        try {
          inputText = await readFile(c.input, "utf8");
          inputFound = true;
        } catch {
          inputText = "(file not found)";
        }

        try {
          promptText = await readFile(c.prompt, "utf8");
          promptFound = true;
        } catch {
          promptText = "(file not found)";
        }

        try {
          outputText = await readFile(c.outputPath, "utf8");
          outputFound = true;
        } catch {
          outputText = "(file not found)";
        }

        return {
          id: c.id,
          input: {
            path: relative(suiteDir, c.input),
            content: inputText,
            exists: inputFound,
          },
          prompt: {
            path: relative(suiteDir, c.prompt),
            content: promptText,
            exists: promptFound,
          },
          output: {
            path: relative(suiteDir, c.outputPath),
            content: outputText,
            exists: outputFound,
          },
          assertions: c.assertions,
        };
      })
    );

    res.json({
      name: suite.name,
      path: relative(process.cwd(), suiteDir) || ".",
      absPath: suiteDir,
      cases: detailedCases,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Run a suite with options
app.post("/api/run", async (req, res) => {
  try {
    const { suitePath = "fixtures/basic", caseId, repeat = 1, provider: providerType = "offline", model } = req.body;
    const absPath = resolve(process.cwd(), suitePath);

    const provider = createProvider({
      provider: providerType,
      model,
    });

    const summary = await runSuite({
      suitePath: absPath,
      caseId: caseId || undefined,
      repeat: Number(repeat) || 1,
      provider,
    });

    const status =
      summary.errors > 0
        ? "ERROR"
        : summary.flaky > 0 || summary.regression > 0
          ? "REGRESSION"
          : "PASS";

    res.json({
      status,
      summary,
    });
  } catch (err) {
    res.status(400).json({
      status: "ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// Initialize a new suite
app.post("/api/init", async (req, res) => {
  try {
    const { dir } = req.body;
    if (!dir) {
      return res.status(400).json({ error: "Missing directory parameter" });
    }
    const targetPath = resolve(process.cwd(), dir);
    const createdPath = await initSuite(targetPath);
    res.json({ success: true, path: relative(process.cwd(), createdPath) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Record live outputs into suite
app.post("/api/record", async (req, res) => {
  try {
    const { suitePath, provider: providerName = "openrouter", model, caseId, force } = req.body;
    if (!suitePath) {
      return res.status(400).json({ error: "Missing suitePath" });
    }

    const provider = createProvider({
      provider: providerName,
      model,
    });

    const summary = await recordSuite({
      suitePath: resolve(process.cwd(), suitePath),
      provider,
      providerName,
      caseId: caseId || undefined,
      force: Boolean(force),
    });

    res.json({ success: true, summary });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Run CLI command and capture output
app.post("/api/cli", async (req, res) => {
  try {
    const { command = "test --suite fixtures/basic" } = req.body;
    // Sanitize command arguments for security
    const cleanCommand = String(command).replace(/^desurf\s*/, "").trim();
    const fullCmd = `npx tsx src/cli.ts ${cleanCommand}`;

    const { stdout, stderr } = await execAsync(fullCmd, {
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 30000,
    }).catch((err) => {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message,
        code: err.code ?? 1,
      };
    });

    res.json({
      stdout,
      stderr,
      code: "code" in (stdout as any) ? (stdout as any).code : 0,
    });
  } catch (err) {
    res.status(500).json({
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      code: 2,
    });
  }
});

app.use(express.static(resolve(process.cwd(), "public")));

// Serve the interactive Web Dashboard for Desurf (Express 5 fallback)
app.use((_req, res) => {
  res.sendFile(resolve(process.cwd(), "public/index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Desurf server running on http://0.0.0.0:${PORT}`);
});
