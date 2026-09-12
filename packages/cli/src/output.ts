// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * The one place `@zuke/cli` writes to the console.
 *
 * A GitHub Actions runner parses the job's output for workflow commands: a
 * line whose first non-blank characters are `::` is executed (`::error::`
 * forges an annotation, `::stop-commands::` silences every command that
 * follows, including Zuke's own `::add-mask::`), and `##[` anywhere in a line
 * is the legacy form. The CLI echoes text it did not author — an unknown
 * command straight from argv, a `--dir` or `--from` the user typed, a path or
 * an error message from the filesystem or a failed spawn, and what a
 * subprocess it ran said — so every line goes out through here and is
 * neutralised when something is parsing for commands. Off a runner nothing
 * scans the stream and the line goes out byte for byte.
 *
 * The sink is `@zuke/core`'s own `cliReporter`, the one every core command
 * writes through, so the escaping has exactly one implementation. It decides
 * per line, not once at import, so an embedder or a test that sets the
 * environment after loading this module is honoured.
 *
 * `tests/output_test.ts` scans this package's source and fails on any other
 * console write, so the guard cannot quietly come undone by a new
 * `console.log` elsewhere.
 *
 * @module
 */

import { cliReporter, detectCiHost, type Reporter } from "@zuke/core";
import { escapeLineIf } from "@zuke/core/render";

/**
 * `line` as it may reach an Actions runner: neutralised while one is parsing
 * the output, untouched anywhere else — the same decision the sink makes,
 * for the one write the sink cannot own: the text Deno's `prompt` puts on the
 * terminal, which carries a default the user typed on the command line.
 */
export function neutralise(line: string): string {
  return escapeLineIf(detectCiHost() === "github", line);
}

/**
 * The CLI's console sink: `info` is stdout, `error` is stderr, and each line
 * is neutralised on an Actions runner before it is written.
 */
export const output: Reporter = cliReporter;
