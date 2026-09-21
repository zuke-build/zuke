// Copyright (c) 2026 the Zuke contributors
// SPDX-License-Identifier: MIT

/**
 * `@zuke/console` — task-shaped console output for Zuke builds, so a build never
 * reaches for `console.log`. A levelled logger (NUKE-style), Spectre.Console-style
 * markup and a semantic theme, and the primitives Zuke draws its own output with
 * (`line`, `rule`, `box`, `table`, target `header`/`summary`).
 *
 * ```ts
 * import { ConsoleTasks as Log } from "@zuke/console";
 *
 * Log.rule("Deploy");
 * Log.info("pushing [bold]core@1.2.0[/]");
 * Log.success("published 4 packages");
 * ```
 *
 * A build can also route the executor's own banners through this package:
 *
 * ```ts
 * import { run } from "@zuke/core";
 * import { consoleRenderer } from "@zuke/console";
 *
 * await run(MyBuild, { renderer: consoleRenderer });
 * ```
 *
 * @module
 */

export {
  type ConsoleOptions,
  ConsoleTasks,
  type ConsoleTasksApi,
  type ErrorOptions,
  type RuleOptions,
  type Sink,
} from "./src/console.ts";
export { type LogLevel } from "./src/level.ts";
// Re-exported from `@zuke/core`, which owns the wordmark: the executor
// prints it in a run's opening banner and a project depends on core alone.
// Kept on this entrypoint so `@zuke/console`'s published surface is unchanged.
export { logoLines, type LogoOptions, ZUKE_LOGO } from "@zuke/core";
export { defaultTheme, type Theme } from "./src/theme.ts";
export { consoleRenderer, createConsoleRenderer } from "./src/renderer.ts";
