/**
 * `@zuke/eslint` — typed `eslint` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it.
 *
 * ```ts
 * import { EslintTasks } from "jsr:@zuke/eslint";
 * await EslintTasks.lint((s) => s.paths("src").ext(".ts", ".tsx").fix());
 * ```
 *
 * @module
 */

export * from "./src/eslint.ts";
