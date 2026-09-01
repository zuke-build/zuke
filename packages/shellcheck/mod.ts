// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/shellcheck` — typed [ShellCheck](https://www.shellcheck.net/) task
 * wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { ShellcheckTasks } from "jsr:@zuke/shellcheck";
 * await ShellcheckTasks.lint((s) =>
 *   s.shell("sh").severity("warning").paths("sh/lib.sh", "bin/gate")
 * );
 * ```
 *
 * @module
 */

export * from "./src/shellcheck.ts";
