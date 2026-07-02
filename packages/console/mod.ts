/**
 * `@zuke/console` — task-shaped console output for Zuke builds, so a build never
 * reaches for `console.log`. A levelled logger (NUKE-style), Spectre.Console-style
 * markup and a semantic theme, and the primitives Zuke draws its own output with
 * (`line`, `rule`, `box`, `table`, target `header`/`summary`).
 *
 * ```ts
 * import { ConsoleTasks as Log } from "jsr:@zuke/console";
 *
 * Log.rule("Deploy");
 * Log.info("pushing [bold]core@1.2.0[/]");
 * Log.success("published 4 packages");
 * ```
 *
 * A build can also route the executor's own banners through this package:
 *
 * ```ts
 * import { run } from "jsr:@zuke/core";
 * import { consoleRenderer } from "jsr:@zuke/console";
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
export { defaultTheme, type Theme } from "./src/theme.ts";
export { consoleRenderer, createConsoleRenderer } from "./src/renderer.ts";
