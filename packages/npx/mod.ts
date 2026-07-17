/**
 * `@zuke/npx` — typed `NpxTasks` wrappers for the `npx` package runner, for use
 * in Zuke build targets (including builds that drive Node projects).
 *
 * ```ts
 * import { NpxTasks } from "jsr:@zuke/npx";
 *
 * await NpxTasks.npx((s) => s.command("cowsay").yes().execArgs("hello"));
 * ```
 *
 * @module
 */

export { NpxSettings, NpxTasks, type NpxTasksApi } from "./src/npx.ts";
