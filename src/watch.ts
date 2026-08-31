/**
 * desurf watch — re-run a suite whenever its files change.
 *
 * The iterate → re-record → re-test loop is the heart of prompt
 * engineering. Without a watch command, every tweak to a prompt, input,
 * output cassette, or suite.json requires an explicit re-invocation of
 * `desurf test` — a slow, forgettable loop that most people abandon.
 *
 * This module watches the suite directory (and its subdirectories) with
 * Node's built-in fs.watch (no new dependencies) and re-runs the suite
 * on every change. It debounces rapid-fire edits (editor autosaves can
 * emit many events per keystroke) and only re-runs once the filesystem
 * has been quiet for a short window.
 *
 * Exit codes on manual interrupt (Ctrl+C) are intentionally 0 — the
 * watcher itself did not fail.
 */

import { watch, type FSWatcher } from "node:fs";
import { access, constants, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { runSuite } from "./runner.js";
import { SavedOutputAdapter } from "./provider.js";
import { loadSuite } from "./offline.js";
import { createProvider } from "./create-provider.js";

export type WatchOptions = {
  suitePath: string;
  caseId?: string;
  repeat?: number;
  provider?: string;
  model?: string;
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  systemPrompt?: string;
  /** Debounce window in ms. Default 250. */
  debounceMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 250;

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Recursively watch a directory tree with fs.watch (best-effort). */
function watchTree(
  root: string,
  onChange: () => void
): { watchers: FSWatcher[]; stop: () => void } {
  const watchers: FSWatcher[] = [];
  const dirs = new Set<string>();

  function watchDir(dir: string): void {
    if (dirs.has(dir)) return;
    dirs.add(dir);
    try {
      const w = watch(dir, { recursive: false }, (_event, filename) => {
        if (!filename) return;
        const full = join(dir, filename.toString());
        // New subdirectories (e.g. `init`) need to be watched too.
        void readdir(full).then(
          () => watchDir(full),
          () => {
            /* file — no further watch needed */
          }
        );
        onChange();
      });
      w.on("error", () => {
        /* watcher errors are non-fatal; keep the others alive */
      });
      watchers.push(w);
    } catch {
      /* directory vanished — skip */
    }
  }

  // Watch the root AND every existing subdirectory: the whole point of
  // watch mode is reacting to edits inside prompts/, inputs/, outputs/.
  watchDir(root);
  void (async () => {
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          const full = join(dir, e.name);
          if (!full.includes("node_modules") && !full.includes(".git")) {
            watchDir(full);
            stack.push(full);
          }
        }
      }
    }
  })();

  return {
    watchers,
    stop: () => {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

/** Print a compact result line for one case (shared with the watch loop). */
function formatWatchResult(
  caseId: string,
  state: string,
  passCount: number,
  total: number
): string {
  const mark = state === "PASS" ? "\u2713" : "\u2717";
  const counts = total > 1 ? ` (${passCount}/${total} passed)` : "";
  return `${mark} ${caseId}: ${state}${counts}`;
}

/**
 * Run one watch iteration and print a compact, diff-focused summary.
 * Returns the exit code a `desurf test` invocation would have produced.
 */
export async function runOnceAndReport(
  options: WatchOptions
): Promise<number> {
  const provider = options.provider
    ? createProvider({
        provider: options.provider,
        model: options.model,
        temperature: options.temperature,
        seed: options.seed,
        maxTokens: options.maxTokens,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        systemPrompt: options.systemPrompt,
      })
    : new SavedOutputAdapter();

  const summary = await runSuite({
    suitePath: options.suitePath,
    caseId: options.caseId,
    repeat: options.repeat,
    provider,
  });

  for (const c of summary.cases) {
    const line = formatWatchResult(
      c.caseId,
      c.state,
      c.passCount,
      c.executions.length
    );
    console.log(line);

    for (const e of c.executions) {
      for (const w of e.warnings ?? []) {
        console.log(`  WARNING: ${w}`);
      }
      if (e.diff) {
        console.log(
          `  diff (saved vs evaluated):\n${e.diff
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n")}`
        );
      }
      if (e.error) {
        console.log(`  ${e.error}`);
      }
    }
  }

  const line = `Results: ${summary.passed} passed, ${summary.flaky} flaky, ${summary.regression} regression, ${summary.errors} error${summary.warnings > 0 ? `, ${summary.warnings} warning` : ""}`;
  console.log(line);

  if (summary.errors > 0) return 2;
  if (summary.flaky > 0 || summary.regression > 0) return 1;
  return 0;
}

/**
 * Watch a suite directory and re-run on every change.
 * Resolves when the watcher is stopped (Ctrl+C); the caller sets exit 0.
 */
export async function watchSuite(options: WatchOptions): Promise<void> {
  const suitePath = options.suitePath;
  if (!(await pathExists(suitePath))) {
    throw new Error(`Suite not found: ${suitePath}`);
  }

  // Resolve the suite directory up front so an early load error is loud.
  const suite = await loadSuite(suitePath);
  const root = suite.rootDir;

  console.log(`Desurf watch — suite "${suite.name}" (${root})`);
  console.log("Watching for changes. Ctrl+C to stop.\n");

  // Initial run.
  try {
    const code = await runOnceAndReport(options);
    console.log(`\n[watch] initial run finished with exit code ${code}\n`);
  } catch (err) {
    console.error(
      `[watch] initial run failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;

  const onChange = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void (async () => {
        if (running) {
          pending = true;
          return;
        }
        running = true;
        try {
          const code = await runOnceAndReport(options);
          console.log(`\n[watch] finished with exit code ${code}\n`);
        } catch (err) {
          console.error(
            `[watch] run failed: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          running = false;
          if (pending) {
            pending = false;
            onChange();
          }
        }
      })();
    }, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  };

  const tree = watchTree(root, onChange);

  return new Promise<void>((resolvePromise) => {
    const onSigint = (): void => {
      tree.stop();
      console.log("\n[watch] stopped");
      resolvePromise();
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigint);
  });
}
