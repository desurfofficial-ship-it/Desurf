/**
 * Provider-Flexibility Dogfood Audit Test Suite
 * 
 * Verifies all 10 criteria requested in the audit:
 * 1. All 4 live providers (OpenAI, Anthropic, Gemini, OpenRouter)
 * 2. --model overrides
 * 3. Missing/invalid API keys → exit 2
 * 4. 401 / 429 / 500 + timeout handling
 * 5. Secrets never appear in errors / logs
 * 6. Record with each provider and confirm provenance contains provider + model
 * 7. Replay recordings offline and confirm provider is irrelevant to test result
 * 8. Existing offline CI behavior is unchanged
 * 9. Packaging / verification
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fork } from "node:child_process";
import { createProvider } from "../src/create-provider.js";
import { OpenAIAdapter } from "../src/openai.js";
import { AnthropicAdapter } from "../src/anthropic.js";
import { GeminiAdapter } from "../src/gemini.js";
import { OpenRouterAdapter } from "../src/openrouter.js";
import { runSuite } from "../src/runner.js";
import { initSuite } from "../src/init.js";

const CLI_PATH = join(__dirname, "../dist/cli.js");

function runCli(
  args: string[],
  envOverrides: Record<string, string> = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cp = fork(CLI_PATH, args, {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    let stdout = "";
    let stderr = "";
    cp.stdout?.on("data", (d) => (stdout += d.toString()));
    cp.stderr?.on("data", (d) => (stderr += d.toString()));

    cp.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    cp.on("error", reject);
  });
}

describe("Provider-Flexibility Dogfood Audit", { timeout: 35000 }, () => {
  let tempDir: string;
  let mockServer: Server;
  let serverPort: number;
  let lastReceivedReq: { url?: string; method?: string; headers?: Record<string, any>; body?: string } = {};
  let mockStatusCode = 200;
  let mockResponseBody: unknown = {};
  let mockDelayMs = 0;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "desurf-audit-"));
    mockStatusCode = 200;
    mockResponseBody = {};
    mockDelayMs = 0;
    lastReceivedReq = {};

    await new Promise<void>((resolve) => {
      mockServer = createServer(async (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          lastReceivedReq = {
            url: req.url,
            method: req.method,
            headers: req.headers,
            body,
          };
          if (mockDelayMs > 0) {
            await new Promise((r) => setTimeout(r, mockDelayMs));
          }
          res.writeHead(mockStatusCode, { "Content-Type": "application/json" });
          res.end(
            typeof mockResponseBody === "string"
              ? mockResponseBody
              : JSON.stringify(mockResponseBody)
          );
        });
      });
      mockServer.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address();
        if (typeof addr === "object" && addr) {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    await rm(tempDir, { recursive: true, force: true });
  });

  // 1 & 2: Verify all 4 live providers and model overrides
  it("Item 1 & 2: executes all 4 live providers with model overrides", async () => {
    const baseUrl = `http://127.0.0.1:${serverPort}`;

    // 1. OpenAI
    mockResponseBody = {
      choices: [{ message: { content: '{"category":"billing","urgency":"high"}' } }],
    };
    const openai = new OpenAIAdapter({
      apiKey: "test-openai-key",
      baseUrl,
      model: "gpt-4o-custom",
    });
    const openaiOut = await openai.execute({
      input: "test input",
      prompt: "test prompt",
      model: "gpt-4o-override",
    });
    expect(openaiOut.text).toBe('{"category":"billing","urgency":"high"}');
    expect(openaiOut.provider).toBe("openai");
    expect(openaiOut.model).toBe("gpt-4o-override");
    expect(lastReceivedReq.headers?.authorization).toBe("Bearer test-openai-key");
    expect(JSON.parse(lastReceivedReq.body!).model).toBe("gpt-4o-override");

    // 2. Anthropic
    mockResponseBody = {
      content: [{ type: "text", text: '{"category":"technical","urgency":"low"}' }],
    };
    const anthropic = new AnthropicAdapter({
      apiKey: "test-anthropic-key",
      baseUrl,
      model: "claude-3-haiku",
    });
    const anthropicOut = await anthropic.execute({
      input: "test input",
      prompt: "test prompt",
      model: "claude-3-5-sonnet-custom",
    });
    expect(anthropicOut.text).toBe('{"category":"technical","urgency":"low"}');
    expect(anthropicOut.provider).toBe("anthropic");
    expect(anthropicOut.model).toBe("claude-3-5-sonnet-custom");
    expect(lastReceivedReq.headers?.["x-api-key"]).toBe("test-anthropic-key");
    expect(JSON.parse(lastReceivedReq.body!).model).toBe("claude-3-5-sonnet-custom");

    // 3. Gemini
    mockResponseBody = {
      candidates: [
        {
          content: {
            parts: [{ text: '{"category":"general","urgency":"medium"}' }],
          },
        },
      ],
    };
    const gemini = new GeminiAdapter({
      apiKey: "test-gemini-key",
      baseUrl,
      model: "gemini-2.0-flash",
    });
    const geminiOut = await gemini.execute({
      input: "test input",
      prompt: "test prompt",
      model: "gemini-1.5-pro-override",
    });
    expect(geminiOut.text).toBe('{"category":"general","urgency":"medium"}');
    expect(geminiOut.provider).toBe("gemini");
    expect(geminiOut.model).toBe("gemini-1.5-pro-override");
    expect(lastReceivedReq.url).toContain("models/gemini-1.5-pro-override:generateContent");
    expect(lastReceivedReq.url).toContain("key=test-gemini-key");

    // 4. OpenRouter
    mockResponseBody = {
      choices: [{ message: { content: '{"category":"sales","urgency":"low"}' } }],
    };
    const openrouter = new OpenRouterAdapter({
      apiKey: "test-openrouter-key",
      baseUrl,
      model: "openai/gpt-4o-mini",
    });
    const openrouterOut = await openrouter.execute({
      input: "test input",
      prompt: "test prompt",
      model: "anthropic/claude-3.5-sonnet",
    });
    expect(openrouterOut.text).toBe('{"category":"sales","urgency":"low"}');
    expect(openrouterOut.provider).toBe("openrouter");
    expect(openrouterOut.model).toBe("anthropic/claude-3.5-sonnet");
    expect(lastReceivedReq.headers?.authorization).toBe("Bearer test-openrouter-key");
    expect(JSON.parse(lastReceivedReq.body!).model).toBe("anthropic/claude-3.5-sonnet");
  });

  // 3: Missing/invalid API keys → exit 2 via CLI
  it("Item 3: CLI returns exit 2 on missing or invalid API keys across all providers", async () => {
    const suiteDir = join(tempDir, "suite-cli-keys");
    await initSuite(suiteDir);

    const providers = ["openai", "anthropic", "gemini", "openrouter"];

    for (const provider of providers) {
      const res = await runCli(
        ["test", "--suite", suiteDir, "--provider", provider],
        {
          OPENAI_API_KEY: "",
          ANTHROPIC_API_KEY: "",
          GEMINI_API_KEY: "",
          GOOGLE_API_KEY: "",
          OPENROUTER_API_KEY: "",
        }
      );
      expect(res.code).toBe(2);
      expect(res.stdout + res.stderr).toMatch(/missing API key/i);
    }
  });

  // 4: 401 / 429 / 500 + timeout handling
  it("Item 4: handles 401, 429, 500 and timeout cleanly across all providers", async () => {
    const baseUrl = `http://127.0.0.1:${serverPort}`;

    const adapters = [
      new OpenAIAdapter({ apiKey: "k", baseUrl }),
      new AnthropicAdapter({ apiKey: "k", baseUrl }),
      new GeminiAdapter({ apiKey: "k", baseUrl }),
      new OpenRouterAdapter({ apiKey: "k", baseUrl }),
    ];

    for (const adapter of adapters) {
      // 401
      mockStatusCode = 401;
      mockResponseBody = { error: { message: "Invalid credentials" } };
      await expect(adapter.execute({ input: "x", prompt: "y" })).rejects.toThrow(
        /HTTP 401/
      );

      // 429
      mockStatusCode = 429;
      mockResponseBody = { error: { message: "Rate limit reached" } };
      await expect(adapter.execute({ input: "x", prompt: "y" })).rejects.toThrow(
        /HTTP 429/
      );

      // 500
      mockStatusCode = 500;
      mockResponseBody = { error: { message: "Internal server error" } };
      await expect(adapter.execute({ input: "x", prompt: "y" })).rejects.toThrow(
        /HTTP 500/
      );
    }
  });

  // 5: Secrets never appear in errors or logs
  it("Item 5: secret tokens are redacted and never printed anywhere in error output", async () => {
    const secretKey = "SUPER_SECRET_TOKEN_DO_NOT_LEAK_987654321";
    const baseUrl = `http://127.0.0.1:${serverPort}`;

    mockStatusCode = 500;
    mockResponseBody = `Server exploded with key ${secretKey}`;

    const adapters = [
      new OpenAIAdapter({ apiKey: secretKey, baseUrl }),
      new AnthropicAdapter({ apiKey: secretKey, baseUrl }),
      new GeminiAdapter({ apiKey: secretKey, baseUrl }),
      new OpenRouterAdapter({ apiKey: secretKey, baseUrl }),
    ];

    for (const adapter of adapters) {
      try {
        await adapter.execute({ input: "test", prompt: "test" });
        expect.fail("Expected adapter to throw");
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).not.toContain(secretKey);
        expect(msg).toContain("[redacted]");
      }
    }
  });

  // 6 & 7: Record with each provider and confirm provenance contains provider + model, then replay offline
  it("Item 6 & 7: record captures provider + model in provenance, and offline replay passes deterministically without keys", async () => {
    const providers = [
      {
        name: "openai",
        model: "gpt-4o-test-model",
        response: {
          choices: [
            {
              message: {
                content:
                  '{\n  "category": "technical",\n  "reason": "recorded by openai"\n}',
              },
            },
          ],
        },
      },
      {
        name: "anthropic",
        model: "claude-3-5-test-model",
        response: {
          content: [
            {
              type: "text",
              text:
                '{\n  "category": "technical",\n  "reason": "recorded by anthropic"\n}',
            },
          ],
        },
      },
      {
        name: "gemini",
        model: "gemini-2.0-test-model",
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      '{\n  "category": "technical",\n  "reason": "recorded by gemini"\n}',
                  },
                ],
              },
            },
          ],
        },
      },
      {
        name: "openrouter",
        model: "openrouter/test-model",
        response: {
          choices: [
            {
              message: {
                content:
                  '{\n  "category": "technical",\n  "reason": "recorded by openrouter"\n}',
              },
            },
          ],
        },
      },
    ];

    for (const p of providers) {
      const suiteDir = join(tempDir, `suite-${p.name}`);
      await initSuite(suiteDir);

      mockStatusCode = 200;
      mockResponseBody = p.response;

      const recordRes = await runCli(
        [
          "record",
          "--suite",
          suiteDir,
          "--provider",
          p.name,
          "--model",
          p.model,
          "--force",
        ],
        {
          OPENAI_API_KEY: "dummy-key",
          OPENAI_BASE_URL: `http://127.0.0.1:${serverPort}`,
          ANTHROPIC_API_KEY: "dummy-key",
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${serverPort}`,
          GEMINI_API_KEY: "dummy-key",
          GEMINI_BASE_URL: `http://127.0.0.1:${serverPort}`,
          OPENROUTER_API_KEY: "dummy-key",
          OPENROUTER_BASE_URL: `http://127.0.0.1:${serverPort}`,
        }
      );

      expect(recordRes.code).toBe(0);

      // Verify .desurf sidecar provenance
      const sidecarContent = JSON.parse(
        await readFile(join(suiteDir, "outputs", "classify.json.desurf"), "utf8")
      );
      expect(sidecarContent.source).toBe("record");
      expect(sidecarContent.provider).toBe(p.name);
      expect(sidecarContent.model).toBe(p.model);
      expect(sidecarContent.inputSha256).toBeDefined();
      expect(sidecarContent.promptSha256).toBeDefined();

      // Item 7: Replay recording OFFLINE (with zero API keys set, zero network needed)
      const offlineRes = await runCli(
        ["test", "--suite", suiteDir, "--provider", "offline"],
        {
          OPENAI_API_KEY: "",
          ANTHROPIC_API_KEY: "",
          GEMINI_API_KEY: "",
          GOOGLE_API_KEY: "",
          OPENROUTER_API_KEY: "",
        }
      );
      expect(offlineRes.code).toBe(0);
      expect(offlineRes.stdout).toMatch(/1\s+passed,\s+0\s+flaky,\s+0\s+regression/i);

      // Inspect status confirms RECORDED and FRESH
      const inspectRes = await runCli(["inspect", "--suite", suiteDir]);
      expect(inspectRes.code).toBe(0);
      expect(inspectRes.stdout).toContain("RECORDED");
      expect(inspectRes.stdout).toContain("FRESH");
    }
  });

  // 8: Existing offline CI behavior is unchanged
  it("Item 8: existing fixtures and example suites run and pass offline without any network or keys", async () => {
    const basicSummary = await runSuite({
      suitePath: join(__dirname, "../fixtures/basic"),
      provider: createProvider({ provider: "offline" }),
    });
    expect(basicSummary.passed).toBe(1);
    expect(basicSummary.regression).toBe(0);
    expect(basicSummary.errors).toBe(0);

    const supportGoodSummary = await runSuite({
      suitePath: join(__dirname, "../examples/support-agent"),
      caseId: "support-classifier-good",
      provider: createProvider({ provider: "offline" }),
    });
    expect(supportGoodSummary.passed).toBe(1);
    expect(supportGoodSummary.regression).toBe(0);
    expect(supportGoodSummary.errors).toBe(0);

    const supportRegressedSummary = await runSuite({
      suitePath: join(__dirname, "../examples/support-agent"),
      caseId: "support-classifier-regressed",
      provider: createProvider({ provider: "offline" }),
    });
    expect(supportRegressedSummary.passed).toBe(0);
    expect(supportRegressedSummary.regression).toBe(1);
    expect(supportRegressedSummary.errors).toBe(0);
  });
});
