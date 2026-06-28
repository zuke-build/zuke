/**
 * Turn a unified `git diff` into GitHub inline {@link Suggestion}s — used by the
 * {@link "./agent_fixer.ts".AgentFixer} to render the changes an agent made as
 * committable suggestions, instead of (or before) committing them.
 *
 * Each contiguous block of removed lines (with the additions that follow it) in
 * a hunk becomes one suggestion anchored to those line numbers on the new file
 * (the PR head). Pure insertions are skipped — GitHub suggestions replace
 * existing lines, so there is nothing to anchor an insertion to.
 *
 * @module
 */

import type { Suggestion } from "./hosts/github_review.ts";

/** The hunk header `@@ -oldStart,oldCount +newStart,newCount @@`. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/** The `suggestion` comment body: a prelude plus a committable block. */
function suggestionBody(prelude: string, additions: string[]): string {
  const block = additions.length === 0
    ? ["```suggestion", "```"]
    : ["```suggestion", ...additions, "```"];
  return [prelude, "", ...block].join("\n");
}

/**
 * Parse a unified diff into inline replacement suggestions. `prelude` is the
 * note shown above each suggestion block.
 */
export function diffToSuggestions(
  diff: string,
  prelude: string,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  let path: string | undefined;
  let oldLine = 0;
  let inHunk = false;

  // The current contiguous change block within a hunk.
  let blockStart = -1;
  let blockEnd = -1;
  let hasRemoval = false;
  let additions: string[] = [];

  const flush = () => {
    if (path !== undefined && hasRemoval) {
      suggestions.push({
        path,
        startLine: blockStart,
        line: blockEnd,
        body: suggestionBody(prelude, additions),
        key: `${path}:${blockStart}`,
      });
    }
    blockStart = -1;
    blockEnd = -1;
    hasRemoval = false;
    additions = [];
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      inHunk = false;
      path = undefined;
      continue;
    }
    if (line.startsWith("+++ b/")) {
      path = line.slice("+++ b/".length).trim();
      continue;
    }
    const hunk = line.match(HUNK);
    if (hunk) {
      flush();
      oldLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined) continue;
    if (line.startsWith("---") || line.startsWith("\\")) continue;
    if (line.startsWith("-")) {
      if (blockStart === -1) blockStart = oldLine;
      blockEnd = oldLine;
      hasRemoval = true;
      oldLine++;
    } else if (line.startsWith("+")) {
      additions.push(line.slice(1));
    } else {
      // A context line ends the current change block.
      flush();
      oldLine++;
    }
  }
  flush();
  return suggestions;
}
