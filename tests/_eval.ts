// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * Running a script given on the command line with the running runtime, so a
 * test that needs a child process spawns `RuntimeTasks.execPath()` the same way
 * on Deno and on Node. The script itself reads `process`, which both provide.
 *
 * @module
 */

import { RuntimeTasks } from "../packages/core/mod.ts";

const deno = RuntimeTasks.facts().name === "deno";

/** The argument that makes the runtime evaluate the next one: `deno eval`, `node -e`. */
export const EVAL = deno ? "eval" : "-e";

/**
 * The expression, for an evaluated script, of the arguments given after the
 * script: Deno lists the script's file before them in `process.argv`, Node
 * does not.
 */
export const ARGS = `process.argv.slice(${deno ? 2 : 1})`;
