/**
 * `@zuke/vitest` — typed `vitest` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. The one-shot `run` subcommand is emitted by default; switch to
 * watch mode with `.watch()`.
 *
 * ```ts
 * import { VitestTasks } from "jsr:@zuke/vitest";
 * await VitestTasks.run((s) => s.coverage().reporter("dot"));
 * ```
 *
 * @module
 */

export * from "./src/vitest.ts";
