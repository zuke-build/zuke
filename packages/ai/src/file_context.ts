// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Full-file context for a review: the post-image contents of the files a diff
 * touches, so the model can verify a finding against the surrounding code (a
 * guard two functions away, an authorization check in the same file) instead
 * of judging hunks in isolation.
 *
 * @module
 */

/** ≈4 characters per token — the same heuristic the diff truncation uses. */
const CHARS_PER_TOKEN = 4;

/**
 * Read the contents of `paths` at `HEAD` (via `git show`, through the same
 * exec seam the diff uses) and assemble them into one labelled block, bounded
 * at roughly `maxTokens`. Files are included in diff order until the budget
 * runs out (the file that crosses it is truncated, the rest are listed as
 * omitted); a file `git` cannot show (deleted, binary quirk) is skipped.
 * Returns an empty string when nothing could be read.
 */
export async function buildFileContext(
  paths: string[],
  run: (argv: string[]) => Promise<string>,
  maxTokens: number,
): Promise<string> {
  let remaining = maxTokens * CHARS_PER_TOKEN;
  const parts: string[] = [];
  const omitted: string[] = [];
  for (const path of paths) {
    if (remaining <= 0) {
      omitted.push(path);
      continue;
    }
    let content: string;
    try {
      content = await run(["git", "show", `HEAD:${path}`]);
    } catch {
      continue; // deleted or unreadable at HEAD — the diff still shows it
    }
    const body = content.length <= remaining
      ? content
      : `${content.slice(0, remaining)}\n… (file truncated) …`;
    remaining -= content.length;
    parts.push(`--- ${path} ---\n${body}`);
  }
  if (parts.length === 0) return "";
  if (omitted.length > 0) {
    parts.push(`(omitted for budget: ${omitted.join(", ")})`);
  }
  return parts.join("\n\n");
}
