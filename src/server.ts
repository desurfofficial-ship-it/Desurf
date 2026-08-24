/**
 * Desurf Web Server
 * Serves the interactive testing dashboard and REST API on port 3000.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { runSuite } from "./runner.js";
import { loadSuite } from "./offline.js";
import { createProvider } from "./create-provider.js";

const PORT = 3000;
const HOST = "0.0.0.0";

const KNOWN_SUITES = [
  { id: "examples/support-agent", name: "Support Agent (Example)", path: "examples/support-agent" },
  { id: "fixtures/basic", name: "Basic Fixture", path: "fixtures/basic" },
];

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });
  res.end(html);
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Desurf — Prompt Behavior & Regression Testing</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #2f81f7;
      --accent-hover: #58a6ff;
      --pass: #238636;
      --pass-badge: #1f6feb;
      --flaky: #d29922;
      --regression: #da3633;
      --error: #f85149;
      --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 24px 16px;
    }
    .container {
      max-width: 980px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .logo-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 12px;
      background: #21262d;
      color: var(--text-muted);
      border: 1px solid var(--card-border);
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    p.subtitle {
      color: var(--text-muted);
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 16px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
    }
    .form-group {
      margin-bottom: 14px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 6px;
      color: var(--text);
    }
    select, input {
      width: 100%;
      padding: 8px 10px;
      background: #0d1117;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
      outline: none;
    }
    select:focus, input:focus {
      border-color: var(--accent);
    }
    button.btn-primary {
      width: 100%;
      background: #238636;
      color: #fff;
      border: 1px solid rgba(240, 246, 252, 0.1);
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s ease;
    }
    button.btn-primary:hover {
      background: #2ea043;
    }
    button.btn-primary:disabled {
      background: #21262d;
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .cli-box {
      margin-top: 16px;
      background: #0d1117;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 10px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: #79c0ff;
      word-break: break-all;
    }
    .stat-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: #0d1117;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 10px;
      text-align: center;
    }
    .stat-val {
      font-size: 20px;
      font-weight: 700;
    }
    .stat-lbl {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      color: var(--text-muted);
    }
    .stat-pass .stat-val { color: #3fb950; }
    .stat-flaky .stat-val { color: #d29922; }
    .stat-regression .stat-val { color: #f85149; }
    .stat-error .stat-val { color: #ff7b72; }

    .case-card {
      background: #0d1117;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 12px;
    }
    .case-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .case-id {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
    }
    .badge-status {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-PASS { background: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid #238636; }
    .badge-FLAKY { background: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid #d29922; }
    .badge-REGRESSION { background: rgba(218, 54, 51, 0.2); color: #f85149; border: 1px solid #da3633; }
    .badge-ERROR { background: rgba(248, 81, 73, 0.2); color: #ff7b72; border: 1px solid #f85149; }

    .assertion-list {
      margin-top: 10px;
      font-size: 13px;
      border-top: 1px solid #21262d;
      padding-top: 8px;
    }
    .assertion-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 4px;
      font-family: var(--font-mono);
      font-size: 12px;
    }
    .assert-pass { color: #3fb950; }
    .assert-fail { color: #f85149; }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
    }
    .spinner {
      border: 2px solid rgba(255,255,255,0.2);
      border-top: 2px solid #fff;
      border-radius: 50%;
      width: 14px;
      height: 14px;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-row">
        <h1>Desurf</h1>
        <span class="badge">v0.1.0</span>
        <span class="badge">Offline-First Engine</span>
      </div>
      <p class="subtitle">Prompt behavior contract and regression testing runner</p>
    </header>

    <div class="grid">
      <!-- Left Config Card -->
      <div class="card">
        <div class="card-title">Test Runner Config</div>
        
        <div class="form-group">
          <label for="suiteSelect">Test Suite</label>
          <select id="suiteSelect" onchange="updateCliPreview()">
            <option value="examples/support-agent">examples/support-agent (Public Suite)</option>
            <option value="fixtures/basic">fixtures/basic (Minimal Fixture)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="repeatInput">Repeat Count (--repeat N)</label>
          <input type="number" id="repeatInput" min="1" max="20" value="3" onchange="updateCliPreview()" oninput="updateCliPreview()">
        </div>

        <div class="form-group">
          <label for="providerSelect">Provider (--provider)</label>
          <select id="providerSelect" onchange="updateCliPreview()">
            <option value="offline">offline (Saved output / deterministic)</option>
            <option value="openrouter">openrouter (Live OpenRouter model)</option>
          </select>
        </div>

        <div class="form-group">
          <label for="caseInput">Case Filter (--case [optional])</label>
          <input type="text" id="caseInput" placeholder="e.g. support-classifier-good" onchange="updateCliPreview()" oninput="updateCliPreview()">
        </div>

        <button id="runBtn" class="btn-primary" onclick="runTests()">
          <span>Run Test Suite</span>
        </button>

        <div style="margin-top: 14px;">
          <label>Equivalent CLI Command:</label>
          <div class="cli-box" id="cliPreview">desurf test --suite examples/support-agent --repeat 3</div>
        </div>
      </div>

      <!-- Right Results Card -->
      <div class="card">
        <div class="card-title">Execution Results</div>
        
        <div id="statsRow" class="stat-row" style="display: none;">
          <div class="stat-card stat-pass">
            <div class="stat-val" id="statPass">0</div>
            <div class="stat-lbl">Pass</div>
          </div>
          <div class="stat-card stat-flaky">
            <div class="stat-val" id="statFlaky">0</div>
            <div class="stat-lbl">Flaky</div>
          </div>
          <div class="stat-card stat-regression">
            <div class="stat-val" id="statRegression">0</div>
            <div class="stat-lbl">Regression</div>
          </div>
          <div class="stat-card stat-error">
            <div class="stat-val" id="statError">0</div>
            <div class="stat-lbl">Error</div>
          </div>
        </div>

        <div id="resultsList">
          <div class="empty-state">
            <p>Select a test suite and click <strong>Run Test Suite</strong> to evaluate prompt assertions.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function updateCliPreview() {
      const suite = document.getElementById('suiteSelect').value;
      const repeat = document.getElementById('repeatInput').value || '1';
      const provider = document.getElementById('providerSelect').value;
      const caseId = document.getElementById('caseInput').value.trim();

      let cmd = 'desurf test --suite ' + suite;
      if (caseId) cmd += ' --case ' + caseId;
      if (repeat && repeat !== '1') cmd += ' --repeat ' + repeat;
      if (provider && provider !== 'offline') cmd += ' --provider ' + provider;

      document.getElementById('cliPreview').textContent = cmd;
    }

    async function runTests() {
      const btn = document.getElementById('runBtn');
      const resultsList = document.getElementById('resultsList');
      const statsRow = document.getElementById('statsRow');

      const suite = document.getElementById('suiteSelect').value;
      const repeat = parseInt(document.getElementById('repeatInput').value, 10) || 1;
      const provider = document.getElementById('providerSelect').value;
      const caseId = document.getElementById('caseInput').value.trim() || undefined;

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Running tests...';
      resultsList.innerHTML = '<div class="empty-state"><span class="spinner"></span> Executing suite ' + suite + '...</div>';

      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suite, repeat, provider, caseId })
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to run tests');
        }

        statsRow.style.display = 'grid';
        document.getElementById('statPass').textContent = data.passed || 0;
        document.getElementById('statFlaky').textContent = data.flaky || 0;
        document.getElementById('statRegression').textContent = data.regression || 0;
        document.getElementById('statError').textContent = data.errors || 0;

        let html = '';
        for (const c of data.cases) {
          const total = c.executions.length;
          let executionsSummary = total > 1 ? '<span style="color: var(--text-muted); font-size: 12px; margin-left: 8px;">(' + c.passCount + '/' + total + ' passed)</span>' : '';
          
          let assertionHtml = '';
          const failing = c.executions.find(e => !e.passed && !e.error);
          const passing = c.executions.find(e => e.passed);
          const sample = failing || passing || c.executions[0];

          if (sample && sample.assertionResults && sample.assertionResults.length > 0) {
            assertionHtml = '<div class="assertion-list">';
            for (const a of sample.assertionResults) {
              const icon = a.passed ? '<span class="assert-pass">✓</span>' : '<span class="assert-fail">✗</span>';
              assertionHtml += '<div class="assertion-item">' + icon + ' <span>' + escapeHtml(a.message) + '</span></div>';
            }
            assertionHtml += '</div>';
          }

          if (c.state === 'ERROR') {
            const errExec = c.executions.find(e => e.error);
            if (errExec) {
              assertionHtml += '<div style="color: #ff7b72; font-size: 12px; font-family: var(--font-mono); margin-top: 8px;">Error: ' + escapeHtml(errExec.error) + '</div>';
            }
          }

          html += '<div class="case-card">' +
            '<div class="case-header">' +
              '<div><span class="case-id">' + escapeHtml(c.caseId) + '</span>' + executionsSummary + '</div>' +
              '<span class="badge-status badge-' + c.state + '">' + c.state + '</span>' +
            '</div>' +
            assertionHtml +
          '</div>';
        }

        resultsList.innerHTML = html;
      } catch (err) {
        statsRow.style.display = 'none';
        resultsList.innerHTML = '<div class="empty-state" style="color: #ff7b72;"><strong>Execution Error:</strong> ' + escapeHtml(err.message) + '</div>';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Run Test Suite</span>';
      }
    }

    function escapeHtml(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Auto-run on load
    runTests();
  </script>
</body>
</html>`;
}

export function startServer(): void {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost:3000"}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(res, 200, { status: "ok", service: "desurf" });
      return;
    }

    if (url.pathname === "/api/suites") {
      const suiteDetails = [];
      for (const s of KNOWN_SUITES) {
        try {
          const loaded = await loadSuite(resolve(process.cwd(), s.path));
          suiteDetails.push({
            id: s.id,
            name: loaded.name,
            path: s.path,
            caseCount: loaded.cases.length,
            cases: loaded.cases.map((c) => ({ id: c.id, assertionCount: c.assertions.length })),
          });
        } catch (err) {
          suiteDetails.push({
            id: s.id,
            name: s.name,
            path: s.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      sendJson(res, 200, { suites: suiteDetails });
      return;
    }

    if (url.pathname === "/api/run" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const suitePathStr = (body.suite as string) || "examples/support-agent";
        const caseId = body.caseId ? String(body.caseId) : undefined;
        const repeat = typeof body.repeat === "number" ? body.repeat : 1;
        const providerName = body.provider ? String(body.provider) : "offline";
        const model = body.model ? String(body.model) : undefined;

        const suitePath = resolve(process.cwd(), suitePathStr);
        const provider = createProvider({ provider: providerName, model });

        const summary = await runSuite({
          suitePath,
          caseId,
          repeat,
          provider,
        });

        sendJson(res, 200, summary);
      } catch (err) {
        sendJson(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      sendHtml(res, getDashboardHtml());
      return;
    }

    sendJson(res, 404, { error: "Not Found" });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Desurf server listening at http://${HOST}:${PORT}`);
  });
}

// Start if executed directly
if (process.argv[1]?.includes("server")) {
  startServer();
}
