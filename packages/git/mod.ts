/**
 * `@zuke/git` — typed `git` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. Typed tasks cover the common commands (add, commit, push, …); use
 * `GitTasks.run` with `.command(...)` for anything else.
 *
 * ```ts
 * import { GitTasks, gitInfo } from "jsr:@zuke/git";
 * await GitTasks.commit((s) => s.all().message("ci: release"));
 * const { branch, shortCommit } = await gitInfo();
 * ```
 *
 * The `gitInfo()` helper resolves repository metadata (branch, commit, tag,
 * dirty state, remote) for versioning and conditional steps.
 *
 * @module
 */

export * from "./src/git.ts";
export * from "./src/git_info.ts";
