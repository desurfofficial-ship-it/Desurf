/**
 * Minimal unified diff for regression output.
 *
 * When an offline test evaluates a drifted baseline (soft cassette) or a
 * live provider run produces output that no longer matches the saved
 * cassette, the user's first question is "what actually changed?". This
 * module produces a compact, dependency-free unified diff between the
 * saved output (old) and the evaluated output (new) — exactly what a
 * regression report needs, without pulling in a diff library.
 *
 * Algorithm: simple Myers-free line diff with common-prefix/suffix
 * trimming and a single changed-hunk replacement. Long outputs are
 * truncated to keep CI logs bounded.
 */

const MAX_DIFF_LINES = 200;

/** Split text into lines, normalizing trailing newline handling. */
function toLines(text: string): string[] {
  const t = text.replace(/\r\n/g, "\n");
  if (t.length === 0) return [];
  const lines = t.split("\n");
  // A trailing newline produces a trailing "" element — drop it so the
  // diff does not show a spurious removed/added empty line.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Format a number for a hunk header (empty for the very first hunk). */
function hunkRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

/**
 * Build a unified diff string between oldText and newText.
 * Returns "" when the texts are equal.
 */
export function unifiedDiff(oldText: string, newText: string): string {
  const oldLines = toLines(oldText);
  const newLines = toLines(newText);

  if (oldLines.length === 0 && newLines.length === 0) return "";
  if (oldLines.join("\n") === newLines.join("\n")) return "";

  // Trim the common prefix and suffix so only the changed region shows.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);

  const out: string[] = [];
  out.push(`@@ -${hunkRange(prefix, oldMid.length)} +${hunkRange(prefix, newMid.length)} @@`);

  for (const line of oldMid) {
    out.push(`-${line}`);
  }
  for (const line of newMid) {
    out.push(`+${line}`);
  }

  const total = out.length;
  if (total > MAX_DIFF_LINES + 2) {
    const kept = out.slice(0, MAX_DIFF_LINES);
    kept.push(
      `... diff truncated (${total - MAX_DIFF_LINES} more lines; run with --verbose for full output)`
    );
    return kept.join("\n");
  }
  return out.join("\n");
}
