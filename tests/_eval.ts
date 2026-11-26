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

/**
 * The arguments that make the running runtime run a script file with every
 * permission: they go before the script's path. Node runs a `.ts` file as it
 * is, resolving `@zuke/*` through the workspace's `node_modules`.
 */
export const RUN = deno ? ["run", "-A"] : [];

/**
 * {@link RUN}, for a standalone script, one that imports nothing through the
 * import map, so Deno neither reads the workspace's config nor its lock.
 */
export const RUN_SCRIPT = deno ? [...RUN, "--no-config", "--no-lock"] : RUN;
