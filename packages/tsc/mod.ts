/**
 * `@zuke/tsc` — typed `tsc` task wrappers for Zuke builds.
 *
 * `tsc` is the TypeScript compiler — since TypeScript 7.0 that binary is the
 * native Go compiler, so this wrapper drives it with no change on your side.
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. Two tasks are exposed: a
 * standard {@link TscTasks.tsc} compile/type-check and a
 * {@link TscTasks.build} project-references build (`tsc --build`).
 *
 * ```ts
 * import { TscTasks } from "jsr:@zuke/tsc";
 * await TscTasks.tsc((s) => s.project("tsconfig.json").noEmit());
 * await TscTasks.build((s) => s.projects("packages/a", "packages/b"));
 * ```
 *
 * @module
 */

export * from "./src/tsc.ts";
