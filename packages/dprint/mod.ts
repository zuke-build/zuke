/**
 * `@zuke/dprint` — typed `dprint` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. `fmt` formats files in place; `check` verifies formatting.
 *
 * ```ts
 * import { DprintTasks } from "jsr:@zuke/dprint";
 * await DprintTasks.check((s) => s.config("dprint.json"));
 * ```
 *
 * @module
 */

export * from "./src/dprint.ts";
