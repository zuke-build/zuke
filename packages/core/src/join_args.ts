// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * {@link joinShellArgs} — render an argv as one POSIX shell command line, the
 * inverse of {@link splitShellArgs}.
 *
 * @module
 */

/** A shell word that needs no quoting: nothing in it is special to the shell. */
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Render `argv` as a single command line a POSIX shell parses back into
 * exactly the same argv — for showing an operator a command to paste, or for
 * handing a command to something that runs it through `sh`.
 *
 * Each token is written as it is when it holds only characters no shell treats
 * specially (letters, digits and `_@%+=:,./-`). Anything else — an empty token,
 * whitespace, a newline, `$`, a backtick, a quote, a glob character — is
 * wrapped in single quotes, with each embedded `'` written as `'\''`. Nothing
 * inside single quotes is special to the shell, so a token can never expand a
 * variable, substitute a command, or become a second command. Tokens are
 * joined by single spaces.
 *
 * ```ts
 * joinShellArgs(["gcloud", "run", "services", "describe", "my svc"]);
 * // gcloud run services describe 'my svc'
 * joinShellArgs(["echo", "it's", ""]);
 * // echo 'it'\''s' ''
 * ```
 *
 * The output round-trips through {@link splitShellArgs}. The quoting governs
 * how each token is split and expanded, not the grammar of the command
 * position: the first token should be the program to run, since a shell reads
 * a leading `NAME=value` as an assignment and a leading `if` as a keyword.
 *
 * @param argv The tokens to render, in order.
 * @returns The command line; an empty string for an empty argv.
 */
export function joinShellArgs(argv: readonly string[]): string {
  return argv.map((token) =>
    PLAIN_WORD.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`
  ).join(" ");
}
