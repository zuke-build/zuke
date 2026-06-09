/**
 * `@zuke/cmd` — generic command execution for Zuke builds: the fallback for
 * tools that have no dedicated wrapper package.
 *
 * ```ts
 * import { CmdTasks } from "jsr:@zuke/cmd";
 *
 * await CmdTasks.exec("git", (s) => s.args("rev-parse", "HEAD"));
 * ```
 *
 * @module
 */

export { CmdSettings, CmdTasks, type CmdTasksApi } from "./src/cmd.ts";
