/**
 * `@zuke/tsx` — typed `tsx` task wrappers for Zuke builds.
 *
 * Configure a fluent settings object in a lambda; the task builds the argv and
 * runs it. The task names mirror the CLI: `tsx` runs an entry point and `watch`
 * re-runs it on changes.
 *
 * ```ts
 * import { TsxTasks } from "jsr:@zuke/tsx";
 * await TsxTasks.tsx((s) => s.script("src/main.ts").tsconfig("tsconfig.json"));
 * ```
 *
 * @module
 */

export * from "./src/tsx.ts";
