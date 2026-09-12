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
 * an error message from the filesystem or a failed spawn — so every line goes
 * out through here and is neutralised with `escapeLineIf` when something is
 * parsing for commands. Off a runner nothing scans the stream and the line
 * goes out byte for byte.
 *
 * This composes the two pieces `@zuke/core` publishes for exactly this —
 * `escapeLineIf` on `@zuke/core/render` and `detectCiHost` — rather than
 * core's own `cliReporter`, which is internal to that package: exporting it
 * would need a core release this package's floor cannot reach in the same
 * change. The decision is made per line, not once at import, so an embedder
 * or a test that sets the environment after loading this module is honoured.
 *
 * `tests/escaping_sink_test.ts` in `@zuke/core` scans this package's source
 * and fails on any other console write, so the guard cannot quietly come
 * undone by a new `console.log` elsewhere.
 *
 * @module
 */

import { detectCiHost, type Reporter } from "@zuke/core";
import { escapeLineIf } from "@zuke/core/render";

/** Whether this process is running on a GitHub Actions runner, right now. */
function onActionsRunner(): boolean {
  return detectCiHost() === "github";
}

/**
 * The CLI's console sink: `info` is stdout, `error` is stderr, and each line
 * is neutralised on an Actions runner before it is written.
 */
export const output: Reporter = {
  info: (line) => console.log(escapeLineIf(onActionsRunner(), line)),
  error: (line) => console.error(escapeLineIf(onActionsRunner(), line)),
};
