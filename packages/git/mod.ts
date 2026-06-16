/**
 * `@zuke/git` — typed `git` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. Typed tasks cover the common commands (add, commit, push, …); use
 * `GitTasks.run` with `.command(...)` for anything else.
 *
 * ```ts
 * import { GitTasks } from "jsr:@zuke/git";
 * await GitTasks.commit((s) => s.all().message("ci: release"));
 * ```
 *
 * @module
 */

export * from "./src/git.ts";
