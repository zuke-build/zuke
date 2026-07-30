/**
 * `@zuke/cmd` — generic command execution for Zuke builds: the fallback for
 * tools that have no dedicated wrapper package.
 *
 * Check the package catalogue in `llms.txt` before reaching for it. A tool with
 * a `@zuke/<tool>` wrapper should be driven through that wrapper — running it
 * here instead gives up typed flags and the wrapper's tool resolution, so the
 * example below deliberately uses a tool Zuke does not wrap.
 *
 * ```ts
 * import { CmdTasks } from "jsr:@zuke/cmd";
 *
 * await CmdTasks.exec("shellcheck", (s) => s.args("--severity", "warning"));
 * ```
 *
 * @module
 */

export { CmdSettings, CmdTasks, type CmdTasksApi } from "./src/cmd.ts";
