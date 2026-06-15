/**
 * `@zuke/oxlint` — typed `oxlint` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { OxlintTasks } from "jsr:@zuke/oxlint";
 * await OxlintTasks.lint((s) => s.paths("src").fix().denyWarnings());
 * ```
 *
 * @module
 */

export * from "./src/oxlint.ts";
