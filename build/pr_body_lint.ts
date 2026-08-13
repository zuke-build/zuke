// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Lints a pull request body for the code fragments that break
 * release-please's conventional-commits parser (see `RELEASING.md`'s "Keep
 * code snippets out of commit message bodies"): because this repo
 * squash-merges, the PR title/body becomes the merged commit that
 * release-please parses, and a fenced code block or an arrow-function/call
 * snippet with parentheses can make the parser choke on the whole commit —
 * silently dropping it from the release with no error surfaced anywhere.
 *
 * The heuristic is deliberately dumb, on purpose: it flags a fenced ```
 * block wholesale, and — outside fences — a line containing an arrow
 * function (`=>`), a zero-argument call statement (`();`), or a member call
 * whose receiver and method are identifiers, as in a `Tasks.method(` fragment.
 * Ordinary prose parentheses, e.g. `(see #241)`, are never flagged; a
 * parenthetical that follows a filename keeps its space, so `cli.md (the
 * reference)` reads as prose while `CmdTasks.exec("docker")` reads as code.
 *
 * @module
 */

/** A member call, `Receiver.method(`, with no space before the parenthesis. */
const MEMBER_CALL = /[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(/;

/**
 * A code-shaped line contains an arrow function, a bare call statement, or a
 * member call.
 */
function isCodeShapedLine(line: string): boolean {
  return line.includes("=>") || /\(\s*\)\s*;/.test(line) ||
    MEMBER_CALL.test(line);
}

/**
 * Lint a PR body/description, returning one human-readable finding per fenced
 * code block and per code-shaped paren-bearing line found outside a fence.
 * An empty result means the body is safe for release-please to parse.
 */
export function lintPrBody(body: string): string[] {
  const findings: string[] = [];
  const lines = body.split("\n");
  let fenceStartLine: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      if (fenceStartLine === undefined) {
        fenceStartLine = lineNo;
      } else {
        findings.push(
          `line ${fenceStartLine}: fenced code block — release-please's ` +
            "parser can choke on parentheses inside it; describe the change " +
            "in prose and move the snippet to the PR discussion instead " +
            "(see RELEASING.md).",
        );
        fenceStartLine = undefined;
      }
      continue;
    }

    // Lines inside a fence are covered by the one finding above; don't also
    // flag individual code-shaped lines within it.
    if (fenceStartLine !== undefined) continue;

    if (isCodeShapedLine(line)) {
      findings.push(
        `line ${lineNo}: looks like a code fragment (${
          JSON.stringify(line.trim())
        }) — an arrow function or call statement's parentheses can break ` +
          "release-please's parser; describe the change in prose instead " +
          "(see RELEASING.md).",
      );
    }
  }

  // An unterminated fence still has parenthesised code inside it somewhere
  // between the opening fence and the end of the body.
  if (fenceStartLine !== undefined) {
    findings.push(
      `line ${fenceStartLine}: unterminated fenced code block — release-please's ` +
        "parser can choke on parentheses inside it; describe the change in " +
        "prose and move the snippet to the PR discussion instead (see " +
        "RELEASING.md).",
    );
  }

  return findings;
}
